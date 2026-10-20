import type { PageConfig } from '../lib/types';
import { PageHero } from './PageView';
import { PolicyBoard } from '../components/PolicyBoard';

export function Policy({ page }: { page: PageConfig }) {
  return (
    <div className="page">
      <PageHero page={page} />
      <PolicyBoard />
    </div>
  );
}
