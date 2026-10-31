import { dirname } from 'node:path'
import { assertWritable } from '../../services/paths'

// A confirmed local operation grants only its target directory for this check.
// Never persist this scope or expand the MCP allow list.
export async function assertUiWritable(target: string, forbidden: string[]): Promise<void> {
  await assertWritable(target, { allowedRoots: [dirname(target)], forbidden })
}
