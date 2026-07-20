if (process.env.IPCRAFT_PUBLISH !== 'confirmed') {
  throw new Error(
    'CLI publication is locked. Publish the matching extension first, then set IPCRAFT_PUBLISH=confirmed for the explicit npm release.'
  );
}
