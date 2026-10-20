import type { PageConfig } from '../lib/types';
import { useStore } from '../data/store';
import { PageHero, ChartSections } from './PageView';
import { DataTable } from '../components/DataTable';
import { dateLabel, inrCompact, num, pct } from '../lib/format';

export function Methodology({ page }: { page: PageConfig }) {
  const { meta, model, ctx } = useStore();
  const rm = meta.returnMethods.recomputed;

  const scenarioRows = (['strict', 'recovery', 'contractual'] as const).map((key) => {
    const s = meta.scenarios[key];
    return {
      scenario: key === 'strict' ? 'Strict write-off' : key === 'recovery' ? 'Recovery 45%' : 'Contractual',
      lent: s.totalLent,
      profit: s.projectedProfit,
      roi: s.roiPct,
      xirr: s.portfolioXirr,
      pos: s.pos,
      loss: s.expectedLoss,
    };
  });

  const qualityRows = [
    ['Missing income', meta.dataQuality.missingIncome, 'Income is null when zero or absent. Not random: informal borrowers declare less.'],
    ['Missing bureau', meta.dataQuality.missingBureau, 'Four loans have no bureau pull. Treat as a separate segment.'],
    ['Missing city', meta.dataQuality.missingCity, 'City could not be parsed from the raw address.'],
    ['Unmapped state', meta.dataQuality.missingState, 'City exists but is not in the curated state map.'],
    ['Duplicate IDs', meta.dataQuality.duplicateIds, 'Loan identifiers should be unique within the export.'],
    ['Closure before disbursement', meta.dataQuality.closureBeforeDisb, 'Date sanity check. Non-zero means a source defect.'],
    ['Past maturity but active', meta.dataQuality.pastMaturityStillActive, 'Active loans beyond contractual maturity: a collection flag.'],
  ].map(([label, value, note]) => ({ label: String(label), value: Number(value), note: String(note) }));

  return (
    <div className="page">
      <PageHero page={page} />

      <section className="prose">
        <h2>What this site is</h2>
        <p>
          A static analytics build over one investor&apos;s LenDenClub P2P loan book: {num(meta.counts.loans)} loans,{' '}
          {inrCompact(meta.totals.lent)} deployed, {num(meta.counts.borrowers)} distinct borrowers, as of {dateLabel(meta.asOf)}. Every
          chart, filter and score is computed in the browser from a sanitised {`loans.json`} — there is no backend and no live platform
          connection.
        </p>
        <p>
          It is an education and research project, not investment advice. Historical NPA does not predict the next default, and a
          scorecard trained on {num(model.observations)} closed loans is a ranking tool, not a credit policy.
        </p>

        <h2>Pipeline</h2>
        <ol>
          <li>Raw platform exports (JSON, HAR, CSV) are downloaded once and kept out of the repository.</li>
          <li>
            <code>scripts/city-map.mjs</code> normalises city and district strings into a canonical city plus an Indian state and a
            tier label. Unmapped places become <code>Other</code> rather than being guessed.
          </li>
          <li>
            <code>scripts/build-data.mjs</code> joins loan, repayment and profile records, derives the 69 analysis fields, trains the
            scorecard and writes three files: <code>loans.json</code> (columnar), <code>meta.json</code> (aggregates and
            dictionaries) and <code>model.json</code> (coefficients, ROC, lift, calibration, WOE, policy grid).
          </li>
          <li>The React app hydrates the columnar file, applies filters in memory and renders charts lazily as they scroll into view.</li>
        </ol>

        <h2>Sanitisation</h2>
        <p>
          Borrower names are published because it makes the analysis auditable and because that was the explicit choice for this
          build. Everything that could be used to contact or impersonate a borrower is removed before the file is written:
        </p>
        <ul>
          <li>PAN, Aadhaar and any tax identifiers</li>
          <li>Phone numbers, email addresses and postal addresses beyond city/state</li>
          <li>Agreement URLs, document IDs and platform account identifiers</li>
          <li>Investor name, PAN, phone, email and bank details</li>
          <li>The raw HAR file, which contains request headers and session tokens</li>
        </ul>
        <p>
          <code>borrowerKey</code> is a one-way grouping key built from name, age and city. It exists only to count repeat borrowing; it
          is not reversible and is not a platform identifier.
        </p>

        <h2>Definitions that change the answer</h2>
        <div className="def-grid">
          <div>
            <h4>NPA</h4>
            <p>
              A loan is NPA when the platform marks it written off (<code>status = 2</code>) or the NPA flag is set. There are{' '}
              {num(meta.counts.npa)} such loans. Delayed active loans are reported separately, never silently merged.
            </p>
          </div>
          <div>
            <h4>Overdue active</h4>
            <p>
              {num(meta.counts.overdueActive)} active loans with DPD &gt; 0, carrying {inrCompact(meta.scenarios.recovery.overdueActivePos)}{' '}
              of principal. These are a probability-weighted loss, not a write-off: a loan can cure.
            </p>
          </div>
          <div>
            <h4>Recovery</h4>
            <p>
              The observed recovery rate is {pct(meta.recoveryRate * 100)} of written-off principal. The base scenario applies that rate
              to impaired active loans; strict applies zero; contractual applies full repayment.
            </p>
          </div>
          <div>
            <h4>Impaired</h4>
            <p>
              NPA plus overdue active: {num(meta.counts.impaired)} loans in total. This is the widest definition of &quot;not
              performing&quot; and the one used for the strict scenario.
            </p>
          </div>
        </div>

        <h2>Why four return numbers disagree</h2>
        <p>
          The platform reports {pct(meta.returnMethods.officialClosedAnr)} ANR on closed loans. Recomputing from the same cash flows
          gives {pct(rm.closedAbsolutePct)} absolute, {pct(rm.closedCapitalTimeAnnualPct)} annualised on capital-time, and{' '}
          {pct(rm.closedPortfolioXirr ?? 0)} money-weighted XIRR. A naive average of per-loan annualised returns gives{' '}
          {pct(rm.closedNaiveMeanAnr)}.
        </p>
        <ul>
          {meta.returnMethods.whyTheyDiffer.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>
          <strong>Use XIRR for decisions.</strong> It is the only method that accounts for when each rupee was invested and returned.
          Use the contractual and strict cases as a range, and never quote the contractual case alone.
        </p>

        <h2>Scenario assumptions</h2>
        <DataTable
          data={{
            columns: [
              { key: 'scenario', label: 'Scenario' },
              { key: 'lent', label: 'Capital', align: 'right', type: 'money' },
              { key: 'profit', label: 'Profit', align: 'right', type: 'money' },
              { key: 'roi', label: 'Simple return', align: 'right', type: 'percent' },
              { key: 'xirr', label: 'XIRR', align: 'right', type: 'percent' },
              { key: 'pos', label: 'Outstanding', align: 'right', type: 'money' },
              { key: 'loss', label: 'Expected loss', align: 'right', type: 'money' },
            ],
            rows: scenarioRows,
          }}
          pageSize={5}
          dense
        />
        <p className="muted small">
          Recovery assumption {pct(ctx.meta.recoveryRate * 100)}, loss given default {pct(ctx.meta.lgd * 100)}. The{' '}
          {inrCompact(meta.totals.npaAmount)} NPA figure is the unpaid principal after partial recoveries already received.
        </p>

        <h2>Model</h2>
        <p>
          A logistic regression on {num(model.observations)} closed loans with {num(model.events)} NPA events. Features are standardised;
          missing numeric values are mean-imputed and counted. Performance: AUC {model.metrics.auc.toFixed(3)}, Gini{' '}
          {model.metrics.gini.toFixed(3)}, KS {model.metrics.ks.toFixed(3)}, 5-fold CV AUC {model.metrics.cvAuc.toFixed(3)}, Brier{' '}
          {model.metrics.brier.toFixed(3)}.
        </p>
        <p>
          The policy grid replays {num(model.policyGrid.length)} score-floor × tenure-cap combinations on the closed book. It inherits
          survivorship bias — loans that never closed are absent — and assumes the historical relationship holds. The 95% upper bound on
          bad rate uses a Wilson interval so small approved pools are visibly uncertain.
        </p>

        <h2>Data quality</h2>
        <DataTable
          data={{
            columns: [
              { key: 'label', label: 'Check' },
              { key: 'value', label: 'Loans', align: 'right', type: 'int' },
              { key: 'note', label: 'Interpretation' },
            ],
            rows: qualityRows,
          }}
          pageSize={10}
          dense
        />

        <h2>Limitations</h2>
        <ul>
          <li>DPD is a snapshot, not a history. Migration between buckets cannot be reconstructed from this export.</li>
          <li>Repayment dates are absent, so XIRR dates closed-loan inflows at closure and active inflows at the as-of date.</li>
          <li>NPA classification lags delinquency by roughly 150 days; recent cohorts look cleaner than they are.</li>
          <li>State is derived from a curated city map, not reported by the platform.</li>
          <li>Income is self-reported and missing for a large share of the book; income-based conclusions are conditional.</li>
          <li>The scorecard is trained and tested on the same book. It has not been validated out of time or out of sample.</li>
        </ul>

        <h2>Reproducing this build</h2>
        <pre>{`git clone https://github.com/chirag127/ldcds
cd ldcds
npm install
npm run data:build   # raw exports -> public/data/*.json
npm run dev          # local site at http://localhost:5173
npm run build        # static bundle in dist/`}</pre>
        <p>
          The raw exports are deliberately not in the repository. <code>npm run data:build</code> regenerates the public dataset from
          files placed in <code>data/raw/</code>; the committed <code>public/data</code> files are the sanitised output of that run.
        </p>

        <h2>Notes from the build</h2>
        <ul>
          {meta.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>Field dictionary</h3>
          <span className="pill info">{meta.columns.length} fields</span>
        </header>
        <DataTable
          data={{
            columns: [
              { key: 'key', label: 'Field' },
              { key: 'label', label: 'Label' },
              { key: 'type', label: 'Type' },
              { key: 'description', label: 'Description' },
            ],
            rows: meta.columns as unknown as Record<string, unknown>[],
          }}
          pageSize={15}
          dense
          exportName="ldc-fields"
        />
      </section>

      <ChartSections page={page} />
      <p className="footnote">
        Dataset schema v{meta.schemaVersion}, generated {meta.generatedAt}. Source: {meta.source}.
      </p>
    </div>
  );
}
