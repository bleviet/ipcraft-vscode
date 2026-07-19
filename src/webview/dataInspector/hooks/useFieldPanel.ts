import { useState } from 'react';
import { BitVector } from '../../../dataInspector/BitVector';
import { copyFieldsForSource, type InspectorField } from '../../../dataInspector/fieldLayout';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import type { RegisterLayoutCopy } from '../../../shared/messages/dataInspector';

interface AddFieldOptions {
  activeSource: IPCraftDataInspectorRecipe['sources'][number] | undefined;
  activeSourceFields: InspectorField[];
  activeSourceVector: BitVector | undefined;
  currentRecipe: IPCraftDataInspectorRecipe;
  setError: (error: string) => void;
  showFields: () => void;
}

interface CopyRegisterLayoutOptions {
  activeSource: IPCraftDataInspectorRecipe['sources'][number] | undefined;
  activeSourceFields: InspectorField[];
  currentRecipe: IPCraftDataInspectorRecipe;
  layout: RegisterLayoutCopy | undefined;
  setError: (error: string) => void;
  showFields: () => void;
}

export function useFieldPanel() {
  const [fields, setFields] = useState<InspectorField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [layoutId, setLayoutId] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [fieldAnnouncement, setFieldAnnouncement] = useState('');
  const [nextFieldNumber, setNextFieldNumber] = useState(1);
  const [fieldProvenance, setFieldProvenance] = useState<
    Record<string, { sourceFile: string; registerName: string }>
  >({});
  const [fieldSourceIds, setFieldSourceIds] = useState<Record<string, string>>({});
  const [newGroupName, setNewGroupName] = useState('');

  const addField = ({
    activeSource,
    activeSourceFields,
    activeSourceVector,
    currentRecipe,
    setError,
    showFields,
  }: AddFieldOptions) => {
    if (!activeSource || !activeSourceVector) {
      return;
    }
    const occupied = new Set(
      activeSourceFields
        .filter((field) => field.groupId === 'default')
        .flatMap((field) =>
          Array.from({ length: field.msb - field.lsb + 1 }, (_, index) => field.lsb + index)
        )
    );
    let bit = activeSourceVector.width - 1;
    while (bit >= 0 && occupied.has(bit)) {
      bit -= 1;
    }
    if (bit < 0) {
      setError('The default overlay group has no unassigned bits');
      return;
    }
    const existingIds = new Set([
      ...currentRecipe.sources.map((source) => source.id),
      ...currentRecipe.fields.map((field) => field.id),
      ...currentRecipe.overlayGroups.map((group) => group.id),
      ...currentRecipe.steps.map((step) => step.id),
    ]);
    let fieldNumber = nextFieldNumber;
    while (existingIds.has(`field-${fieldNumber}`)) {
      fieldNumber += 1;
    }
    const id = `field-${fieldNumber}`;
    setNextFieldNumber(fieldNumber + 1);
    setFields((current) => [
      ...current,
      { id, name: `FIELD_${fieldNumber}`, msb: bit, lsb: bit, groupId: 'default' },
    ]);
    setFieldSourceIds((current) => ({ ...current, [id]: activeSource.id }));
    setSelectedFieldId(id);
    showFields();
  };

  const removeField = (fieldId: string) => {
    const removed = fields.find((field) => field.id === fieldId);
    if (!removed) {
      return;
    }
    setFields((current) => current.filter((field) => field.id !== fieldId));
    setFieldSourceIds((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setSelectedFieldId((current) => (current === fieldId ? null : current));
    setFieldAnnouncement(`Removed field ${removed.name}`);
  };

  const updateSelectedField = (patch: Partial<InspectorField>) => {
    if (!selectedFieldId) {
      return;
    }
    setFields((current) =>
      current.map((field) => (field.id === selectedFieldId ? { ...field, ...patch } : field))
    );
  };

  const copySelectedRegisterLayout = ({
    activeSource,
    activeSourceFields,
    currentRecipe,
    layout,
    setError,
    showFields,
  }: CopyRegisterLayoutOptions) => {
    if (!layout || !activeSource) {
      return;
    }
    const activeIds = new Set(activeSourceFields.map((field) => field.id));
    const reservedIds = new Set([
      ...currentRecipe.sources.map((source) => source.id),
      ...currentRecipe.fields.filter((field) => !activeIds.has(field.id)).map((field) => field.id),
      ...currentRecipe.overlayGroups.map((group) => group.id),
      ...currentRecipe.steps.map((step) => step.id),
    ]);
    const importedFields = copyFieldsForSource(layout.fields, activeSource.id, reservedIds);
    setFields((current) => [
      ...current.filter((field) => !activeIds.has(field.id)),
      ...importedFields,
    ]);
    setFieldProvenance((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([fieldId]) => !activeIds.has(fieldId))),
      ...Object.fromEntries(
        importedFields.map((field) => [
          field.id,
          { sourceFile: layout.sourceFile, registerName: layout.registerName },
        ])
      ),
    }));
    setFieldSourceIds((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([fieldId]) => !activeIds.has(fieldId))),
      ...Object.fromEntries(importedFields.map((field) => [field.id, activeSource.id])),
    }));
    if (layout.width !== activeSource.width) {
      setError(
        `Copied ${layout.width}-bit register layout onto a ${activeSource.width}-bit value; out-of-range fields are flagged below`
      );
    }
    showFields();
  };

  return {
    addField,
    copySelectedRegisterLayout,
    draggedFieldId,
    fieldAnnouncement,
    fieldProvenance,
    fields,
    fieldSearch,
    fieldSourceIds,
    layoutId,
    newGroupName,
    nextFieldNumber,
    removeField,
    selectedFieldId,
    setDraggedFieldId,
    setFieldProvenance,
    setFields,
    setFieldSearch,
    setFieldSourceIds,
    setLayoutId,
    setNewGroupName,
    setNextFieldNumber,
    setSelectedFieldId,
    updateSelectedField,
  };
}

export type FieldPanelState = ReturnType<typeof useFieldPanel>;
