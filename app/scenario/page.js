import { requireSession } from '../../lib/auth';
import AuthControls from '../auth-controls';
import Calculator from './calculator';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSession();
  return <><AuthControls /><Calculator /></>;
}
