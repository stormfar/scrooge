import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { FinanceProvider, useFinanceData } from './hooks/useFinanceData';
import { IncomePage } from './pages/IncomePage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { RetirementPage } from './pages/RetirementPage';
import { SetupPage } from './pages/SetupPage';

function AppRoutes() {
  const { data, loading, error, reload } = useFinanceData();

  if (loading && !data) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (error && !data) {
    return (
      <div className="space-y-3 p-8">
        <p className="text-sm text-destructive">Failed to load: {error}</p>
        <Button onClick={() => void reload()}>Retry</Button>
      </div>
    );
  }
  if (!data) return null;

  const home = data.settings.onboarded ? '/investments' : '/setup';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={home} replace />} />
        <Route path="investments" element={<InvestmentsPage />} />
        <Route path="income" element={<IncomePage />} />
        <Route path="retirement" element={<RetirementPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <FinanceProvider>
      <TooltipProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </FinanceProvider>
  );
}
