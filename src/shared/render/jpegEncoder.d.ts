// jpeg-js's index also loads its (pdf.js-derived, Apache-2.0) decoder; only the encoder module
// is imported so the decoder stays out of dist/cli.js. Declares the one function used.
declare module 'jpeg-js/lib/encoder' {
  function encode(
    image: { data: Uint8Array; width: number; height: number },
    quality?: number
  ): { data: Uint8Array; width: number; height: number };
  export = encode;
}
