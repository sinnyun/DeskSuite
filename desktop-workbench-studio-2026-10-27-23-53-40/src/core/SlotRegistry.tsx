import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { PluginDefinition, SlotContribution, SlotId } from '../types/workbench';

interface SlotRegistryContextType {
  plugins: PluginDefinition[];
  registerPlugin: (plugin: PluginDefinition) => void;
  unregisterPlugin: (pluginId: string) => void;
  getSlotContributions: (slotId: SlotId) => SlotContribution[];
  getAllContributions: () => SlotContribution[];
}

const SlotRegistryContext = createContext<SlotRegistryContextType | undefined>(undefined);

export const SlotRegistryProvider: React.FC<{
  initialPlugins?: PluginDefinition[];
  children: React.ReactNode;
}> = ({ initialPlugins = [], children }) => {
  const [plugins, setPlugins] = useState<PluginDefinition[]>(initialPlugins);

  const registerPlugin = useCallback((plugin: PluginDefinition) => {
    setPlugins((prev) => {
      const existsIndex = prev.findIndex((p) => p.id === plugin.id);
      if (existsIndex >= 0) {
        const next = [...prev];
        next[existsIndex] = plugin;
        return next;
      }
      return [...prev, plugin];
    });
  }, []);

  const unregisterPlugin = useCallback((pluginId: string) => {
    setPlugins((prev) => prev.filter((p) => p.id !== pluginId));
  }, []);

  const allContributions = useMemo(() => {
    return plugins
      .filter((p) => p.enabled !== false)
      .flatMap((p) => p.contributions);
  }, [plugins]);

  const getSlotContributions = useCallback(
    (slotId: SlotId): SlotContribution[] => {
      return allContributions
        .filter((c) => c.slotId === slotId)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    },
    [allContributions]
  );

  const getAllContributions = useCallback(() => allContributions, [allContributions]);

  return (
    <SlotRegistryContext.Provider
      value={{
        plugins,
        registerPlugin,
        unregisterPlugin,
        getSlotContributions,
        getAllContributions,
      }}
    >
      {children}
    </SlotRegistryContext.Provider>
  );
};

export const useSlotRegistry = (): SlotRegistryContextType => {
  const context = useContext(SlotRegistryContext);
  if (!context) {
    throw new Error('useSlotRegistry must be used within a SlotRegistryProvider');
  }
  return context;
};

interface SlotRendererProps<P = Record<string, unknown>> {
  slotId: SlotId;
  fallback?: React.ReactNode;
  props?: P;
  className?: string;
  wrapper?: (contribution: SlotContribution<P>, renderedNode: React.ReactNode) => React.ReactNode;
  single?: boolean;
}

export const SlotRenderer = <P extends Record<string, unknown> = Record<string, unknown>>({
  slotId,
  fallback = null,
  props,
  className = '',
  wrapper,
  single = false,
}: SlotRendererProps<P>): React.ReactElement | null => {
  const { getSlotContributions } = useSlotRegistry();
  const contributions = getSlotContributions(slotId);

  if (contributions.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  const itemsToRender = single ? contributions.slice(0, 1) : contributions;

  return (
    <div className={className}>
      {itemsToRender.map((contribution) => {
        const rendered = contribution.render((props || {}) as P);
        if (wrapper) {
          return (
            <React.Fragment key={contribution.id}>
              {wrapper(contribution as SlotContribution<P>, rendered)}
            </React.Fragment>
          );
        }
        return <React.Fragment key={contribution.id}>{rendered}</React.Fragment>;
      })}
    </div>
  );
};
