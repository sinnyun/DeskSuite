import React from 'react';
import { useTheme } from './ThemeContext';

export interface DesktopButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'subtle' | 'danger' | 'pill';
  size?: 'xs' | 'sm' | 'md';
  icon?: React.ReactNode;
  active?: boolean;
}

export const DesktopButton: React.FC<DesktopButtonProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  icon,
  active = false,
  className = '',
  disabled,
  ...props
}) => {
  const { accent, isDark } = useTheme();

  // FileAtlas Primary Accent Styles (Purple / Indigo)
  const primaryStyles = 'bg-[#5b5ce6] hover:bg-[#4e4fcb] text-white shadow-xs active:bg-[#3f40b5] dark:bg-[#7c7df6] dark:hover:bg-[#9394f8] dark:text-white font-medium';

  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-150 rounded-xl cursor-pointer select-none whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5ce6]/40';

  const sizeStyles = {
    xs: 'px-2.5 py-1 text-xs gap-1.5 h-7 text-[11px]',
    sm: 'px-3 py-1.5 text-xs gap-1.5 h-8',
    md: 'px-4 py-2 text-sm gap-2 h-9.5',
  };

  let variantStyle = '';
  if (variant === 'primary') {
    variantStyle = primaryStyles;
  } else if (variant === 'pill') {
    variantStyle = active
      ? 'bg-[#5b5ce6] text-white shadow-xs font-semibold'
      : 'bg-white hover:bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140]';
  } else if (variant === 'ghost') {
    variantStyle = active
      ? 'bg-[#eef2ff] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6] font-semibold'
      : 'text-[#64748b] dark:text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.05]';
  } else if (variant === 'subtle') {
    variantStyle =
      'bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#334155] dark:bg-[#222834] dark:hover:bg-[#2a3140] dark:text-[#cbd5e1] border border-[#e2e8f0] dark:border-[#2a3140]';
  } else if (variant === 'danger') {
    variantStyle =
      'bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 active:bg-rose-200';
  } else {
    // FileAtlas Standard Button
    variantStyle = active
      ? 'bg-[#eef2ff] text-[#5b5ce6] border border-[#5b5ce6]/30 dark:bg-[#252846] dark:text-[#7c7df6] dark:border-[#7c7df6]/40 shadow-xs'
      : 'bg-white hover:bg-[#f8fafc] text-[#334155] border border-[#e2e8f0] shadow-xs dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#e2e8f0] dark:border-[#2a3140] active:scale-[0.98]';
  }

  const disabledStyle = disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : '';

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyle} ${disabledStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
};

export interface DesktopIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  active?: boolean;
  tooltip?: string;
  size?: 'xs' | 'sm' | 'md';
}

export const DesktopIconButton: React.FC<DesktopIconButtonProps> = ({
  icon,
  active = false,
  tooltip,
  size = 'sm',
  className = '',
  ...props
}) => {
  const sizeStyles = {
    xs: 'w-7 h-7 p-1 text-xs rounded-lg',
    sm: 'w-8 h-8 p-1.5 text-sm rounded-xl',
    md: 'w-9 h-9 p-2 text-base rounded-xl',
  };

  const activeStyles = active
    ? 'bg-[#eef2ff] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6] shadow-2xs font-semibold'
    : 'text-[#64748b] dark:text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#222834] active:scale-95';

  return (
    <button
      type="button"
      title={tooltip}
      className={`inline-flex items-center justify-center transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5ce6]/40 ${sizeStyles[size]} ${activeStyles} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};

export interface DesktopTabProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string | number;
  onClose?: () => void;
  className?: string;
}

export const DesktopTab: React.FC<DesktopTabProps> = ({
  title,
  icon,
  active,
  onClick,
  badge,
  onClose,
  className = '',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer transition-all whitespace-nowrap shrink-0 rounded-xl ${
        active
          ? 'bg-white dark:bg-[#1a1e27] text-[#5b5ce6] dark:text-[#7c7df6] shadow-xs border border-[#e2e8f0] dark:border-[#2a3140] font-semibold'
          : 'text-[#64748b] dark:text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#1a1e27]/60'
      } ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{title}</span>
      {badge !== undefined && (
        <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-[#f1f5f9] dark:bg-[#222834] text-[#475569] dark:text-[#cbd5e1] font-mono tabular-nums">
          {badge}
        </span>
      )}
      {onClose && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-black/[0.08] dark:hover:bg-white/[0.12] rounded p-0.5 transition-opacity"
        >
          ×
        </span>
      )}
    </button>
  );
};

export interface DesktopInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  shortcutHint?: string;
}

export const DesktopInput: React.FC<DesktopInputProps> = ({
  icon,
  clearable,
  onClear,
  shortcutHint,
  className = '',
  value,
  onChange,
  ...props
}) => {
  return (
    <div className={`relative flex items-center w-full ${className}`}>
      {icon && (
        <span className="absolute left-3 text-[#94a3b8] dark:text-[#64748b] pointer-events-none shrink-0">
          {icon}
        </span>
      )}
      <input
        type="text"
        value={value}
        onChange={onChange}
        className={`w-full h-8 text-xs rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-[#1e293b] dark:text-[#f1f5f9] placeholder:text-[#94a3b8] dark:placeholder:text-[#64748b] shadow-2xs focus:outline-none focus:border-[#5b5ce6] focus:ring-2 focus:ring-[#5b5ce6]/20 transition-all ${
          icon ? 'pl-8.5' : 'pl-3'
        } ${shortcutHint || clearable ? 'pr-12' : 'pr-3'}`}
        {...props}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2.5 text-xs text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white p-0.5 rounded cursor-pointer"
        >
          ✕
        </button>
      )}
      {shortcutHint && !value && (
        <span className="absolute right-2.5 text-[10px] font-mono text-[#94a3b8] dark:text-[#64748b] bg-[#f1f5f9] dark:bg-[#222834] px-1.5 py-0.5 rounded-full border border-[#e2e8f0] dark:border-[#2a3140] pointer-events-none">
          {shortcutHint}
        </span>
      )}
    </div>
  );
};

export interface DesktopCardProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  interactive?: boolean;
}

// FileAtlas Rounded-2xl Card
export const DesktopCard: React.FC<DesktopCardProps> = ({
  children,
  selected = false,
  interactive = false,
  className = '',
  ...props
}) => {
  return (
    <div
      className={`rounded-2xl border transition-all duration-150 ${
        selected
          ? 'bg-white border-[#5b5ce6] ring-2 ring-[#5b5ce6]/25 dark:bg-[#1a1e27] dark:border-[#7c7df6] shadow-sm'
          : 'bg-white dark:bg-[#1a1e27] border-[#e2e8f0] dark:border-[#2a3140] shadow-xs'
      } ${
        interactive
          ? 'cursor-pointer hover:border-[#5b5ce6]/60 dark:hover:border-[#7c7df6]/60 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] active:translate-y-0'
          : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

// FileAtlas Tag Capsule with leading dot (• 投放渠道, • 设计资产)
export interface DesktopTagPillProps {
  label: string;
  variant?: 'blue' | 'emerald' | 'amber' | 'purple' | 'rose' | 'neutral';
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export const DesktopTagPill: React.FC<DesktopTagPillProps> = ({
  label,
  variant = 'blue',
  className = '',
  onClick,
}) => {
  const pillVariants: Record<string, string> = {
    blue: 'bg-[#eff6ff] text-[#2563eb] border-[#dbeafe] dark:bg-[#1e293b] dark:text-[#60a5fa] dark:border-[#2563eb]/40',
    purple: 'bg-[#f5f3ff] text-[#7c3aed] border-[#ede9fe] dark:bg-[#2e1065]/40 dark:text-[#c084fc] dark:border-[#7c3aed]/40',
    amber: 'bg-[#fffbeb] text-[#d97706] border-[#fef3c7] dark:bg-[#451a03]/40 dark:text-[#fbbf24] dark:border-[#d97706]/40',
    emerald: 'bg-[#ecfdf5] text-[#059669] border-[#d1fae5] dark:bg-[#064e3b]/40 dark:text-[#34d399] dark:border-[#059669]/40',
    rose: 'bg-[#fff1f2] text-[#e11d48] border-[#ffe4e6] dark:bg-[#4c0519]/40 dark:text-[#fb7185] dark:border-[#e11d48]/40',
    neutral: 'bg-[#f1f5f9] text-[#475569] border-[#e2e8f0] dark:bg-[#222834] dark:text-[#cbd5e1] dark:border-[#2a3140]',
  };

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border leading-none transition-all ${
        pillVariants[variant] || pillVariants.neutral
      } ${onClick ? 'cursor-pointer hover:brightness-95 active:scale-95' : ''} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-90" />
      <span>{label}</span>
    </span>
  );
};

// Re-export standard theme panel layout components
export * from './panels';

