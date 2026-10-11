// Clean the URL so it always ends with /run regardless of what is set in env
const RAW_RUNNER_URL = process.env.RUNNER_URL || 'https://code-volt.onrender.com';
const RUNNER_BASE = RAW_RUNNER_URL.replace(/\/run\/?$/, '').replace(/\/+$/, '');
const RUNNER_URL = `${RUNNER_BASE}/run`;

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
      throw new Error(`Runner service HTTP error: ${response.statusText} (${response.status}) at ${RUNNER_URL}`);
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