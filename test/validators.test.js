const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGithubUrl, repoNameFromUrl, suggestedSshUrl } = require('../src/core/validators');

test('github repo validators accept https and ssh formats', () => {
  const urls = [
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo',
    'git@github.com:owner/repo.git',
    'git@github.com:owner/repo'
  ];
  for (const url of urls) {
    assert.equal(validateGithubUrl(url), true);
    assert.equal(repoNameFromUrl(url), 'repo');
    assert.equal(suggestedSshUrl(url), 'git@github.com:owner/repo.git');
  }
});
