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

/**
 * Hook for managing navigation between IP core sections
 */
export function useNavigation() {
  const [selectedSection, setSelectedSection] = useState<Section>('metadata');

  /**
   * Navigate to a specific section
   */
  const navigate = useCallback((section: Section) => {
    setSelectedSection(section);
  }, []);

  return {
    selectedSection,
    navigate,
  };
}
