import React from 'react';

/**
 * Status over the canvas while the extension re-reads the design; the old diagram stays usable.
 * The live region is always present so screen readers announce a new message.
 */
export function BusyIndicator({ message }: { message?: string }) {
  return (
    <div className={message ? 'sd-busy' : 'sr-only'} role="status" aria-live="polite">
      {message && (
        <>
          <span className="sd-busy-spinner" aria-hidden="true" />
          {message}
        </>
      )}
    </div>
  );
}
