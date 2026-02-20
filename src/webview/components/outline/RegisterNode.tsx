import React from 'react';

interface RegisterNodeProps {
  id: string;
  isSelected: boolean;
  onClick: () => void;
  paddingLeft: string;
  name: React.ReactNode;
  offsetLabel: string;
}

const RegisterNode = ({
  id,
  isSelected,
  onClick,
  paddingLeft,
  name,
  offsetLabel,
}: RegisterNodeProps) => {
  return (
    <div
      key={id}
      className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      style={{ paddingLeft }}
    >
      <span
        className={`codicon codicon-symbol-variable text-[16px] ${isSelected ? '' : 'opacity-70'}`}
      ></span>
      {name}
      <span className="text-[10px] vscode-muted font-mono">{offsetLabel}</span>
    </div>
  );
};

export default RegisterNode;
