import React from 'react';
import type { IpCore } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import {
  parseVersionScheme,
  validateVersion,
} from '../../../../../../shared/versioning/versionScheme';
import type { VersionScheme } from '../../../../../../shared/versioning/versionScheme';
import { PropField, PropSelect } from '../controls/InspectorFields';

const SCHEME_OPTIONS: Array<{ value: VersionScheme; label: string }> = [
  { value: 'free', label: 'Free text' },
  { value: 'major.minor', label: 'MAJOR.MINOR' },
  { value: 'major.minor.patch', label: 'MAJOR.MINOR.PATCH' },
  { value: 'major.feature.minor.patch', label: 'MAJOR.FEATURE.MINOR.PATCH' },
];

const VERSION_PLACEHOLDER: Record<VersionScheme, string> = {
  free: '1.0.0',
  'major.minor': '1.0',
  'major.minor.patch': '1.0.0',
  'major.feature.minor.patch': '1.0.0.0',
};

interface VersionFieldsProps {
  version: string;
  versionScheme: IpCore['vlnv']['versionScheme'];
  onUpdate: YamlUpdateHandler;
}

/**
 * The `vlnv.versionScheme` selector and the `vlnv.version` field it validates. Switching the
 * scheme never rewrites the version; a version that no longer fits is flagged under the field.
 */
export const VersionFields: React.FC<VersionFieldsProps> = ({
  version,
  versionScheme,
  onUpdate,
}) => {
  const scheme = parseVersionScheme(versionScheme);
  const currentError = validateVersion(scheme, version);
  return (
    <>
      <PropSelect
        label="Version scheme"
        value={scheme}
        options={SCHEME_OPTIONS}
        onSave={(value) =>
          onUpdate(['vlnv', 'versionScheme'], value === 'free' ? undefined : value)
        }
      />
      <PropField
        label="Version"
        value={version}
        onSave={(v) => onUpdate(['vlnv', 'version'], v)}
        validate={(v) => validateVersion(scheme, v)}
        hasError={currentError !== null}
        errorMsg={currentError ?? undefined}
        placeholder={VERSION_PLACEHOLDER[scheme]}
        mono
      />
    </>
  );
};
