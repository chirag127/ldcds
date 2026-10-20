import type { PageConfig } from '../lib/types';
import { PageHero, ChartSections } from './PageView';
export function Executive({ page }: { page: PageConfig }) {
  return (
    <div className="page">
      <PageHero page={page} />
      <ChartSections page={page} />
    </div>
  );
}
