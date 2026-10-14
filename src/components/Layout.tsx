import { NavLink, Outlet } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/components/ui/button';
import { useFinanceData } from '../hooks/useFinanceData';

const LINKS = [
  { to: '/investments', label: 'Investments' },
  { to: '/income', label: 'Income' },
  { to: '/retirement', label: 'Retirement' },
  { to: '/setup', label: 'Setup' },
];

export function Layout() {
  const { saving } = useFinanceData();
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
          <NavLink to="/investments" className="flex items-center" aria-label="Scrooge, go to Investments">
            <img src="/logo.png" alt="Scrooge" className="h-9 w-auto" />
          </NavLink>
          <nav className="flex items-center gap-1">
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => cn(buttonVariants({ variant: isActive ? 'secondary' : 'ghost' }))}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
