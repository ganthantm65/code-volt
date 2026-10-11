import express from 'express';
import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const app = express();
app.use(express.json({ limit: '10mb' }));

const TIMEOUT_MS = 3000;

function runProcess(command, args, inputData, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    let isKilled = false;

    const timer = setTimeout(() => {
      isKilled = true;
      proc.kill('SIGKILL');
      resolve({ success: false, error: 'Time Limit Exceeded (3s)', stdout: '' });
    }, TIMEOUT_MS);

    if (inputData) {
      proc.stdin.write(inputData);
    }
    proc.stdin.end();

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (isKilled) return;
      if (code !== 0) {
        resolve({
          success: false,
          error: stderr.trim() || `Process exited with code ${code}`,
          stdout: stdout.trim()
        });
      } else {
        resolve({ success: true, stdout: stdout.trim(), error: '' });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message, stdout: '' });
    });
  });
}

function execCommand(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr.trim() || err.message });
      } else {
        resolve({ success: true, stdout: stdout.trim() });
      }
    });
  });
}

app.post('/run', async (req, res) => {
  const { language = 'python', source_code, code, test_cases = [] } = req.body;
  const programCode = source_code || code || '';
  const lang = language.toLowerCase();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge_'));
  const results = {
    all_passed: true,
    passed_count: 0,
    total_count: test_cases.length,
    logs: []
  };

  try {
    if (lang === 'python') {
      const srcFile = path.join(tempDir, 'solution.py');
      fs.writeFileSync(srcFile, programCode);

      for (let i = 0; i < test_cases.length; i++) {
        const tc = test_cases[i];
        // '-u' forces unbuffered stdout so output is immediately sent to pipe
        const run = await runProcess('python3', ['-u', srcFile], tc.input, tempDir);
        const expected = String(tc.expected_output ?? '').trim();
        const passed = run.success && run.stdout === expected;

        if (passed) results.passed_count++;
        else results.all_passed = false;

        results.logs.push({
          case: i + 1,
          passed,
          actual: run.stdout,
          expected,
          error: run.error
        });
      }
    } else if (lang === 'cpp' || lang === 'c++') {
      const srcFile = path.join(tempDir, 'solution.cpp');
      const binFile = path.join(tempDir, 'solution.out');
      fs.writeFileSync(srcFile, programCode);

      const compile = await execCommand(`g++ -O2 "${srcFile}" -o "${binFile}"`, tempDir);
      if (!compile.success) {
        return res.json({
          all_passed: false,
          passed_count: 0,
          total_count: test_cases.length,
          logs: [{ error: `Compilation Error:\n${compile.error}` }]
        });
      }

      for (let i = 0; i < test_cases.length; i++) {
        const tc = test_cases[i];
        const run = await runProcess(binFile, [], tc.input, tempDir);
        const expected = String(tc.expected_output ?? '').trim();
        const passed = run.success && run.stdout === expected;

        if (passed) results.passed_count++;
        else results.all_passed = false;

        results.logs.push({
          case: i + 1,
          passed,
          actual: run.stdout,
          expected,
          error: run.error
        });
      }
    } else if (lang === 'java') {
      const srcFile = path.join(tempDir, 'Solution.java');
      fs.writeFileSync(srcFile, programCode);

      const compile = await execCommand(`javac "${srcFile}"`, tempDir);
      if (!compile.success) {
        return res.json({
          all_passed: false,
          passed_count: 0,
          total_count: test_cases.length,
          logs: [{ error: `Compilation Error:\n${compile.error}` }]
        });
      }

      for (let i = 0; i < test_cases.length; i++) {
        const tc = test_cases[i];
        const run = await runProcess('java', ['-Xmx128m', 'Solution'], tc.input, tempDir);
        const expected = String(tc.expected_output ?? '').trim();
        const passed = run.success && run.stdout === expected;

        if (passed) results.passed_count++;
        else results.all_passed = false;

        results.logs.push({
          case: i + 1,
          passed,
          actual: run.stdout,
          expected,
          error: run.error
        });
      }
    } else {
      return res.status(400).json({ error: `Unsupported language: ${language}` });
    }
  } catch (err) {
    results.all_passed = false;
    results.logs.push({ error: err.message });
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }

  res.json(results);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Node.js Sandbox Runner active on port ${PORT}`);
});