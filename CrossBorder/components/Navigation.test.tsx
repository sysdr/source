import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Navigation from './Navigation';

describe('Navigation', () => {
  it('renders app title and branding', () => {
    render(<Navigation activeTab="dashboard" setActiveTab={() => {}} />);
    expect(screen.getByText('CrossBorder')).toBeInTheDocument();
    expect(screen.getByText('Financial OS')).toBeInTheDocument();
  });

  it('renders all navigation tabs', () => {
    render(<Navigation activeTab="dashboard" setActiveTab={() => {}} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Data Sync')).toBeInTheDocument();
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Financial Books')).toBeInTheDocument();
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('highlights active tab', () => {
    render(<Navigation activeTab="revenue" setActiveTab={() => {}} />);
    // Prefer text+closest over getByRole name regex — under parallel load
    // accessible-name computation on the full nav tree has timed out (flake).
    const revenueBtn = screen.getByText('Revenue').closest('button');
    expect(revenueBtn).not.toBeNull();
    expect(revenueBtn).toHaveAttribute('aria-current', 'page');
  });

  it('calls setActiveTab when tab is clicked', () => {
    const setActiveTab = vi.fn();
    render(<Navigation activeTab="dashboard" setActiveTab={setActiveTab} />);
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    expect(setActiveTab).toHaveBeenCalledWith('admin');
  });

  it('shows org name when provided', () => {
    render(<Navigation activeTab="dashboard" setActiveTab={() => {}} orgName="Acme Corp" />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('shows "Select org" when org name is not provided', () => {
    render(<Navigation activeTab="dashboard" setActiveTab={() => {}} />);
    expect(screen.getByText('Select organisation')).toBeInTheDocument();
  });

  it('renders People tab when feature flag enabled', () => {
    render(<Navigation activeTab="dashboard" setActiveTab={() => {}} portalRole="admin" />);
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
  });

  it('employee portal only shows workspace tabs', () => {
    render(
      <Navigation
        activeTab="emp-home"
        setActiveTab={() => {}}
        portalRole="employee"
        userLabel="Ada Lovelace"
      />,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('My profile')).toBeInTheDocument();
    expect(screen.getByText('Pay & slips')).toBeInTheDocument();
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
});
