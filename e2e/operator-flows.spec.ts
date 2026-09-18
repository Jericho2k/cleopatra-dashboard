import { expect, test } from '@playwright/test'

const unknownRepair = {
  id: 'repair-1',
  reference: 'purchase-old',
  review_case_id: 'case-access',
  status: 'unknown',
  media_ids: ['media-old'],
  platform_message_id: null,
  claimed_by: 'owner-1',
  detail: 'platform response was lost',
  claimed_at: '2026-09-18T10:00:00Z',
  resolved_at: '2026-09-18T10:00:02Z',
  settled: false,
  needs_operator_decision: true,
}

test.beforeEach(async ({ page }) => {
  await page.route('**/__adapter/repair', async route => {
    const body = route.request().postDataJSON()
    expect(body).toEqual({
      resolution: 'resend_paid_content',
      reference: 'purchase-old',
      review_case_id: 'case-access',
    })
    await route.fulfill({
      json: {
        repair: unknownRepair,
        current_hold: 'crisis_support · case-crisis (preserved)',
      },
    })
  })
  await page.route('**/__adapter/memory', route => route.fulfill({ json: { ok: true } }))
  await page.route('**/__adapter/reply', async route => {
    expect(route.request().postDataJSON()).toEqual({
      content: 'edited by owner',
      suggestion_token: 'suggestion-1',
      suggestion_edited: true,
    })
    await route.fulfill({ json: { accepted: true } })
  })
  await page.route('**/__adapter/reply-trace', route => route.fulfill({
    json: {
      creator_id: 'creator-1',
      fan_id: 'fan-1',
      messages: [{
        id: 'message-1',
        sent_at: '2026-09-18T10:00:00Z',
        trace: { record: { reply_provenance: {
          trigger: { kind: 'fan_message', text_fingerprint: 'fan-fp' },
          context: { packet: { content_digest: 'evidence-fp' } },
          decision: { source: 'owner_selection', action: 'reply' },
          writer: {
            requested: { provider: 'together', model: 'writer-a' },
            actual: { provider: 'openrouter', model: 'writer-b' },
            served_by_requested_model: false,
          },
          transforms: ['operator_edit'],
          delivery: { kind: 'text', accepted_by_platform: true, platform_message_id: 'platform-1' },
        } } },
      }],
    },
  }))
  await page.route('**/__adapter/generate', async route => {
    await new Promise(resolve => setTimeout(resolve, 150))
    await route.fulfill({ json: { reply: 'late model reply' } })
  })
  await page.goto('/e2e-operator-flows')
})

test('older-purchase repair stays unknown, cannot repeat, and preserves a newer hold', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Choose an item to resend' })).toBeDisabled()
  await page.getByText('bought 2026-08-01').click()
  await page.getByRole('button', { name: 'Resend it free' }).click()

  await expect(page.getByText(/could not be confirmed/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resend it free' })).toBeDisabled()
  await expect(page.getByTestId('active-hold')).toContainText('crisis_support · case-crisis (preserved)')
})

test('operator corrects and closes memory through the production memory panel', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept('he prefers hotel sets'))
  await page.getByText('he prefers outdoor sets').locator('..').getByRole('button', { name: 'Fix wording' }).click()
  await expect(page.getByText('he prefers hotel sets')).toBeVisible()

  await page.getByText('whether she ever visits Chicago').locator('..').getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('whether she ever visits Chicago')).toHaveCount(0)
  await expect(page.getByText('1 thing is being carried forward')).toBeVisible()
})

test('edited Assisted reply is attributable in the owner trace inspector', async ({ page }) => {
  await page.getByLabel('Assisted reply text').fill('edited by owner')
  await page.getByRole('button', { name: 'Approve Assisted reply' }).click()

  await page.locator('summary').filter({ hasText: 'openrouter / writer-b' }).click()
  await expect(page.getByText('fan message · fan-fp')).toBeVisible()
  await expect(page.getByText('evidence-fp')).toBeVisible()
  await expect(page.getByText('operator edit')).toBeVisible()
  await expect(page.getByText(/accepted by platform/)).toBeVisible()
})

test('operator takeover discards an in-flight result and rollback restores supervised generation', async ({ page }) => {
  await page.getByRole('button', { name: 'Generate' }).click({ noWaitAfter: true })
  await page.getByRole('button', { name: 'Take over' }).click()
  await expect(page.getByTestId('generation-state')).toHaveText('discarded after takeover')

  await page.getByRole('button', { name: 'Rollback takeover' }).click()
  await expect(page.getByTestId('generation-state')).toHaveText('rolled back to supervised')
  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByTestId('generation-state')).toHaveText('accepted: late model reply')
})
