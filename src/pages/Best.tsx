import type { PageConfig } from '../lib/types';
import { PageView } from './PageView';

export function Best({ page }: { page: PageConfig }) {
  return <PageView page={page} />;
}
