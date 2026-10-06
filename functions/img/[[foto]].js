// Fotos enviadas pelo painel: GET /img/<nome>.webp
import { servirImagem } from '../../lib/loja.js';

export const onRequestGet = servirImagem;
