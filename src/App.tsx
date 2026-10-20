import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DataProvider, useStore } from './data/store';
import { PAGES, chartCount } from './lib/pages';
import { PageView } from './pages/PageView';
import { Underwriting } from './pages/Underwriting';
import { Explorer } from './pages/Explorer';
import { Opportunities } from './pages/Opportunities';
import { Methodology } from './pages/Methodology';
import { Sidebar, TopBar } from './components/Shell';
import { FilterPanel } from './components/FilterPanel';
import { LoanDrawer } from './components/LoanDrawer';
import { CommandPalette } from './components/CommandPalette';

function ScrollManager() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash.length > 1) {
      const id = decodeURIComponent(location.hash.slice(1));
      const node = document.getElementById(id);
      if (node) {
        setTimeout(() => node.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, location.hash]);
  return null;
}

function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { filterOpen, setFilterOpen } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape' && filterOpen) setFilterOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filterOpen, setFilterOpen]);

  return (
    <div className="app">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main">
        <TopBar onMenu={() => setNavOpen(true)} onSearch={() => setPaletteOpen(true)} />
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/executive" replace />} />
            {PAGES.map((page) => (
              <Route
                key={page.id}
                path={`/${page.id}`}
                element={
                  page.custom === 'underwriting' ? (
                    <Underwriting page={page} />
                  ) : page.custom === 'explorer' ? (
                    <Explorer page={page} />
                  ) : page.custom === 'opportunities' ? (
                    <Opportunities page={page} />
                  ) : page.custom === 'methodology' ? (
                    <Methodology page={page} />
                  ) : (
                    <PageView page={page} />
                  )
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/executive" replace />} />
          </Routes>
          <footer className="site-foot">
            <span>
              {chartCount()} charts · 16 tabs · 5,567 loans · as of 20 Oct 2026
            </span>
            <span>
              Names published by design. PAN, phone, email, agreement links and investor PII removed. Not investment advice.
            </span>
          </footer>
        </main>
      </div>
      <FilterPanel />
      {filterOpen ? <div className="scrim" onClick={() => setFilterOpen(false)} /> : null}
      <LoanDrawer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ScrollManager />
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <DataProvider>
        <Layout />
      </DataProvider>
    </HashRouter>
  );
}
