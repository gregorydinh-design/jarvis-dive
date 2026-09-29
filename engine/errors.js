// JARVIS DIVE — Erreurs du moteur : un code stable + des paramètres, traduits par l'interface.
export class DiveError extends Error {
  constructor(code, params = {}, message = code) {
    super(message);
    this.name = 'DiveError';
    this.code = code;
    this.params = params;
  }
}
