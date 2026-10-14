import React, { useCallback, useMemo } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import type { RegisterDef } from '../../types/memoryMap';
import type { VersionRef } from '../../../shared/versioning/versionScheme';
import type { BitVector } from '../../../dataInspector/BitVector';
import type { FieldModel } from '../BitFieldVisualizer';
import ValueBar from '../bitfield/ValueBar';
import { useValueEditing } from '../bitfield/useValueEditing';
import {
  applyRegisterBitVectorToFields,
  buildRegisterBitVector,
  describeConstantFieldMismatches,
  findUnstorableBitRanges,
  formatBitRanges,
  registerResetToBitVector,
} from '../bitfield/utils';
import { decideRegisterToken, parseRegisterValueDraft } from '../bitfield/registerValueToken';
import { fieldResetsWriteUpdate } from '../../services/RegisterEditOperation';

export interface RegisterValueBarProps {
  registerSize: number;
  /** The register's own storage, used when it has no bit fields. */
  register: Pick<RegisterDef, 'resetValue'> & { versionRef?: VersionRef | null };
  /** The register's fields with token fields already resolved (see `versionRef`). */
  fields: FieldModel[];
  debugMode: boolean;
  /** Debug Mode override of the register's own `resetValue`. */
  debugRegisterReset: number | bigint | null;
  /** The number a `$version` reference stands for (0 when unresolved). */
  resolveRef: (ref: VersionRef) => number;
  /** Writes the register's own `resetValue`; Debug Mode keeps it local. */
  onUpdateRegisterReset: YamlUpdateHandler;
  /**
   * Writes to the document, bypassing Debug Mode (which never reaches it): a `$version`
   * reference, or the atomic register edit that clears a leftover register-level reference.
   */
  onUpdateDocument: YamlUpdateHandler;
  onUpdateFieldReset: (fieldIndex: number, value: number | bigint | null) => void;
}

/**
 * The register value bar. A register's value has no storage of its own: it is composed from the
 * bit fields (token fields are constants), or from the register's own `resetValue` (a number or
 * its `$version` token) when it has none.
 */
export function RegisterValueBar({
  registerSize,
  register,
  fields,
  debugMode,
  debugRegisterReset,
  resolveRef,
  onUpdateRegisterReset,
  onUpdateDocument,
  onUpdateFieldReset,
}: RegisterValueBarProps) {
  const registerValue = useMemo(() => {
    // Without bit fields there is nothing to compose a value from, so the
    // register's own `resetValue` (or its `$version` token, resolved) is both
    // the source and the storage.
    if (fields.length === 0) {
      const stored = debugMode && debugRegisterReset !== null ? debugRegisterReset : null;
      const own = register.versionRef ? resolveRef(register.versionRef) : register.resetValue;
      return registerResetToBitVector(stored ?? own, registerSize);
    }
    return buildRegisterBitVector(fields, registerSize);
  }, [
    fields,
    registerSize,
    debugMode,
    debugRegisterReset,
    register.resetValue,
    register.versionRef,
    resolveRef,
  ]);

  const applyRegisterValue = useCallback(
    (value: BitVector) => {
      if (fields.length === 0) {
        const raw = value.toBigInt();
        if (raw === null) {
          return null;
        }
        // Re-committing the displayed value must not turn a `$version` token into a number.
        if (register.versionRef && value.equals(registerValue)) {
          return null;
        }
        if (!debugMode && raw > BigInt(Number.MAX_SAFE_INTEGER)) {
          return "Values above JavaScript's safe integer limit require Debug Mode";
        }
        onUpdateRegisterReset(
          ['resetValue'],
          raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : raw
        );
        return null;
      }

      // Every bit is stored in the field that owns it, so a set bit outside
      // all field ranges has nowhere to go and would be dropped silently.
      const unstorable = findUnstorableBitRanges(fields, value);
      if (unstorable.length > 0) {
        return `Bits ${formatBitRanges(unstorable)} are not covered by a bit field`;
      }
      // Token fields are constants: reject a value that changes them, never write them.
      const constantMismatch = describeConstantFieldMismatches(fields, registerValue, value);
      if (constantMismatch) {
        return constantMismatch;
      }
      const skipConstants =
        (write: (fieldIndex: number, fieldValue: number | bigint) => void) =>
        (fieldIndex: number, fieldValue: number | bigint) => {
          if (!fields[fieldIndex]?.versionRef) {
            write(fieldIndex, fieldValue);
          }
        };

      let unsafeForYaml = false;
      applyRegisterBitVectorToFields(
        fields,
        value,
        skipConstants((_fieldIndex, fieldValue) => {
          unsafeForYaml ||= typeof fieldValue === 'bigint';
        })
      );
      if (!debugMode && unsafeForYaml) {
        return "Values above JavaScript's safe integer limit require Debug Mode";
      }
      // A leftover register-level reference next to bit fields is invalid: the commit removes it
      // in the same update as the field writes.
      if (!debugMode && register.versionRef) {
        const resets: Array<{ fieldIndex: number; value: number | bigint }> = [];
        applyRegisterBitVectorToFields(
          fields,
          value,
          skipConstants((fieldIndex, fieldValue) => resets.push({ fieldIndex, value: fieldValue }))
        );
        onUpdateDocument(...fieldResetsWriteUpdate(resets));
        return null;
      }
      applyRegisterBitVectorToFields(fields, value, skipConstants(onUpdateFieldReset));
      return null;
    },
    [
      fields,
      onUpdateDocument,
      onUpdateFieldReset,
      onUpdateRegisterReset,
      debugMode,
      registerValue,
      register.versionRef,
    ]
  );

  const applyRegisterToken = useCallback(
    (token: VersionRef) => {
      const decision = decideRegisterToken({ token, hasFields: fields.length > 0, debugMode });
      if (decision.kind === 'error') {
        return decision.message;
      }
      onUpdateDocument(['resetValue'], decision.token);
      return null;
    },
    [fields.length, debugMode, onUpdateDocument]
  );

  const parseValueDraft = (text: string, view: 'hex' | 'dec') =>
    parseRegisterValueDraft(text, view, registerSize);

  const {
    valueView,
    setValueView,
    valueDraft,
    setValueDraft,
    setValueEditing,
    valueError,
    setValueError,
    validateRegisterValue,
    commitRegisterValueDraft,
  } = useValueEditing({
    registerSize,
    registerValue,
    parseRegisterValue: parseValueDraft,
    applyRegisterValue,
    applyRegisterToken,
  });

  return (
    <ValueBar
      valueDraft={valueDraft}
      valueError={valueError}
      valueView={valueView}
      setValueDraft={setValueDraft}
      setValueEditing={setValueEditing}
      setValueError={setValueError}
      setValueView={setValueView}
      parseRegisterValue={parseValueDraft}
      validateRegisterValue={validateRegisterValue}
      commitRegisterValueDraft={commitRegisterValueDraft}
      hint={fields.length === 0 && register.versionRef ? `= ${register.versionRef}` : undefined}
    />
  );
}
