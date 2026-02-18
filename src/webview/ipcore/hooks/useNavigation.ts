import { useState, useCallback } from 'react';

export type Section =
  | 'metadata'
  | 'clocks'
  | 'resets'
  | 'ports'
  | 'busInterfaces'
  | 'memoryMaps'
  | 'parameters'
  | 'fileSets'
  | 'generate';

export interface SectionMeta {
  selectedIndex?: number;
  expandedIndices?: Set<number>;
  [key: string]: any;
}

/**
 * Hook for managing navigation between IP core sections
 */
export function useNavigation() {
  const [selectedSection, setSelectedSection] = useState<Section>('metadata');
  const [sectionMeta, setSectionMeta] = useState<Record<Section, SectionMeta>>({
    metadata: {},
    clocks: {},
    resets: {},
    ports: {},
    busInterfaces: {},
    memoryMaps: {},
    parameters: {},
    fileSets: {},
    generate: {},
  });

  /**
   * Navigate to a specific section
   */
  const navigate = useCallback((section: Section, meta?: SectionMeta) => {
    setSelectedSection(section);
    if (meta) {
      setSectionMeta((prev) => ({
        ...prev,
        [section]: { ...prev[section], ...meta },
      }));
    }
  }, []);

  /**
   * Update metadata for current section
   */
  const updateSectionMeta = useCallback((section: Section, updates: Partial<SectionMeta>) => {
    setSectionMeta((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...updates },
    }));
  }, []);

  /**
   * Get metadata for a section
   */
  const getSectionMeta = useCallback(
    (section: Section): SectionMeta => {
      return sectionMeta[section];
    },
    [sectionMeta]
  );

  return {
    selectedSection,
    navigate,
    sectionMeta,
    updateSectionMeta,
    getSectionMeta,
  };
}
