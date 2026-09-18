import { notFound } from 'next/navigation'

import OperatorFlowHarness from './OperatorFlowHarness'

export const dynamic = 'force-dynamic'

export default function OperatorFlowPage() {
  if (process.env.OPERATOR_E2E_HARNESS !== '1') notFound()
  return <OperatorFlowHarness />
}
