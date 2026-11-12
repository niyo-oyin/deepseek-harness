import { describe, expect, it } from 'vitest'
import { runsGitPush } from '../src/push-command.ts'

describe('runsGitPush', () => {
  it.each([
    'git push',
    'git push origin main --force-with-lease',
    'git -C /repo push',
    'git -c http.sslVerify=false --git-dir /repo/.git push origin',
    'GIT.EXE push',
    '"C:\\Program Files\\Git\\cmd\\git.exe" push origin main',
    '& "C:\\Program Files\\Git\\bin\\git.exe" push',
    '/usr/bin/git push',
    'git add . && git commit -m "wip" && git push',
    'git commit -m done; git push',
    'npm test || git push',
    'cd repo\ngit push',
    'GIT_SSH_COMMAND="ssh -i key" git push',
    '$env:GIT_TRACE=1; git push',
    'sudo -u deploy git push',
    'env GIT_TRACE=1 time git push',
  ])('finds the push in %j', (command) => {
    expect(runsGitPush(command)).toBe(true)
  })

  it.each([
    'bash -lc "git fetch && git push origin HEAD"',
    'pwsh -NoProfile -Command "git push"',
    'cmd /c "git push origin main"',
    'eval "git push"',
    'Invoke-Expression \'git push\'',
    'Start-Process git -ArgumentList push',
    'echo $(git push 2>&1)',
    '(cd repo && git push)',
    'if ($ok) { git push }',
    'x=`git push`',
    'sh -c "bash -c \'git push\'"',
    'bash -c "bash -c \\"git push\\""',
    'pwsh -Command "pwsh -Command `"git push`""',
    '"C:\\repo\\" ; git push',
  ])('finds the push another shell or a substitution runs in %j', (command) => {
    expect(runsGitPush(command)).toBe(true)
  })

  it.each([
    '',
    'git status',
    'git pull --rebase',
    'git log --oneline -5',
    'git stash push -m wip',
    'git commit -m "push the fix"',
    'git commit -m \'do not push yet\'',
    'gitk push',
    'cat git push.txt',
    'npm run push',
    'git config push.default simple',
    'git -C push status',
  ])('finds no push in %j', (command) => {
    expect(runsGitPush(command)).toBe(false)
  })

  it('asks about a command that only mentions a push rather than miss one', () => {
    // Printing the words runs nothing, but nothing in the text tells a wrapper before git from a command that prints its arguments.
    expect(runsGitPush('echo git push')).toBe(true)
  })

  it('stops following quoted payloads at a nesting no shell command reaches', () => {
    const nested = (depth: number): string => depth === 0 ? 'git push' : `sh -c ${JSON.stringify(nested(depth - 1))}`
    expect(runsGitPush(nested(2))).toBe(true)
    expect(runsGitPush(nested(8))).toBe(false)
  })
})
