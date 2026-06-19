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
    const revenueBtn = screen.getByRole('button', { name: /^Revenue$/i });
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
});
