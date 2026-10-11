const RUNNER_URL = process.env.RUNNER_URL || 'https://code-volt.onrender.com/run';

async function executeViaDockerRunner(language, sourceCode, testCases) {
  try {
    const response = await fetch(RUNNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language,
        source_code: sourceCode,
        test_cases: testCases
      })
    });

    if (!response.ok) {
      throw new Error(`Runner service HTTP error: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    return {
      all_passed: false,
      passed_count: 0,
      total_count: testCases.length,
      logs: [{ error: `Sandbox Communication Error: ${err.message}` }]
    };
  }
}

export async function evaluateSubmissionLive(challenge, submissionPayload) {
  const { challenge_type, content_payload, solution_payload } = challenge;

  // 1. JUMBLED CODE EVALUATION
  if (challenge_type === 'JUMBLED_CODE') {
    const { order, language = 'python' } = submissionPayload;

    const blockMap = new Map();
    (content_payload.blocks || []).forEach(b => blockMap.set(b.id, b.code));

    const userOrderedCode = (order || [])
      .map(id => blockMap.get(id) || '')
      .join('\n');

    const harness = content_payload.harness?.[language] || '';
    const fullRunnableCode = harness
      .replace('// __USER_CODE_HERE__', userOrderedCode)
      .replace('# __USER_CODE_HERE__', userOrderedCode);

    const testCasesToRun = solution_payload.hidden_test_cases || [];
    const execution = await executeViaDockerRunner(language, fullRunnableCode, testCasesToRun);

    return {
      is_correct: execution.all_passed,
      test_cases_passed: execution.passed_count,
      total_test_cases: execution.total_count,
      feedback: execution.all_passed
        ? 'Code executed in Docker Sandbox and passed all hidden test cases!'
        : 'Execution failed or produced wrong output on hidden test cases.',
      logs: execution.logs
    };
  }

  // 2. INVALID TEST CASE EVALUATION
  if (challenge_type === 'INVALID_TEST_CASE') {
    const { target_test_case_id, corrected_input, corrected_expected_output, language = 'python' } = submissionPayload;
    const { invalid_test_case_id, base_code, test_cases = [] } = solution_payload;

    if (target_test_case_id !== invalid_test_case_id) {
      return {
        is_correct: false,
        test_cases_passed: 0,
        total_test_cases: test_cases.length,
        feedback: 'Incorrect test case targeted. That test case is already valid!'
      };
    }

    const updatedTestCases = test_cases.map(tc => {
      if (tc.id === target_test_case_id) {
        return {
          input: corrected_input !== undefined ? String(corrected_input) : tc.input,
          expected_output: corrected_expected_output !== undefined ? String(corrected_expected_output) : tc.expected_output
        };
      }
      return tc;
    });

    const runnableCode = base_code[language];
    const execution = await executeViaDockerRunner(language, runnableCode, updatedTestCases);

    return {
      is_correct: execution.all_passed,
      test_cases_passed: execution.passed_count,
      total_test_cases: execution.total_count,
      feedback: execution.all_passed
        ? 'Defective test case successfully fixed! Docker Sandbox verified all test cases.'
        : 'Correct test case identified, but your modified input/output failed.',
      logs: execution.logs
    };
  }

  return { is_correct: false, test_cases_passed: 0, total_test_cases: 0, feedback: 'Invalid challenge type.' };
}