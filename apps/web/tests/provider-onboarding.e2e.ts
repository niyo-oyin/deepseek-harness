// Keyless browser e2e: a first run with no usable provider and no default model.
// The in-app first-run step shows the Models page's add-provider panel, on the
// web page and under the Desktop page global alike, with DeepSeek as one choice
// among the others; "later" dismisses it, and adding a provider ends it. With a
// provider but no default, the composer waits for a model pick, and the first
// pick becomes the default. Zero model calls: every step is settings,
// credentials, and llm-domain traffic, and the routes are local fixtures.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const PROVIDER_STEP = '添加一个模型提供方开始使用'
const CHOOSE_MODEL = '请先选择模型，再开始对话。'

describe.skipIf(MODE === 'record').each([false, true])('web e2e: vendor-neutral first run (Desktop page global: %s)', (desktop) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    if (desktop) await page.addInitScript(() => { Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } }) })
    tripwire = watchConsole(page)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('ships no default model and offers every provider, DeepSeek among them, by name', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-provider-onboarding-offer-${String(desktop)}`))
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toBeUndefined()
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const step = page.getByRole('dialog', { name: PROVIDER_STEP })
    await step.waitFor({ timeout: 30_000 })
    const options = await step.getByLabel('提供商', { exact: true }).locator('option').allTextContents()
    expect(options).toContain('DeepSeek')
    expect(options).toEqual(options.toSorted((left, right) => left.toLowerCase() < right.toLowerCase() ? -1 : 1))
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
  }, 60_000)

  it('dismisses with later and writes nothing', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-provider-onboarding-later-${String(desktop)}`))
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8').catch(() => '')
    const step = page.getByRole('dialog', { name: PROVIDER_STEP })
    await step.getByRole('button', { name: '稍后配置', exact: true }).click()
    await step.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    expect(await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8').catch(() => '')).toBe(credentials)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('ends once a provider is added through the same panel', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-provider-onboarding-add-${String(desktop)}`))
    await page.reload({ waitUntil: 'load' })
    const step = page.getByRole('dialog', { name: PROVIDER_STEP })
    await step.waitFor({ timeout: 30_000 })
    await step.getByLabel('提供商', { exact: true }).selectOption('minimax-cn')
    await step.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('sk-e2e-minimax')
    await step.getByRole('button', { name: '保存', exact: true }).click()
    await step.waitFor({ state: 'detached', timeout: 15_000 })
    // The key is stored under its reference, never in plain text, and DeepSeek stays without one.
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials).toContain('MINIMAX_CN_API_KEY:')
    expect(credentials).not.toContain('sk-e2e-minimax')
    expect(credentials).not.toContain('DEEPSEEK_API_KEY')
    // Adding a provider picks no model: the owner chooses.
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toBeUndefined()
    expect((await page.content()).includes('sk-e2e-minimax')).toBe(false)
  }, 60_000)

  it('blocks the composer until a model is picked, and the first pick becomes the default', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-provider-onboarding-first-pick-${String(desktop)}`))
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, `first-pick-${String(desktop)}`, false, CHOOSE_MODEL)
    const box = page.locator('[data-composer-input]').first()
    expect(await box.getAttribute('contenteditable')).toBe('false')

    await page.getByRole('button', { name: '请选择模型', exact: true }).click()
    await page.getByRole('menuitemradio').first().click()
    await expect.poll(async () => box.getAttribute('contenteditable'), { timeout: 15_000 }).toBe('true')
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection()?.provider, { timeout: 15_000 }).toBe('minimax-cn')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
