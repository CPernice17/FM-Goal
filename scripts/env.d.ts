// Tipi minimi di Node per gli script, senza dipendere da @types/node.
declare const process: {
  argv: string[];
  exitCode: number | undefined;
};
