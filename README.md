# WhatsApp Web Whisper

Extensão para Chrome/Edge que adiciona um botão **📝 Transcrever** em cada áudio do WhatsApp Web.
A transcrição roda **localmente** no seu computador com o [Whisper](https://github.com/openai/whisper)
(via Transformers.js + ONNX Runtime, na GPU com WebGPU ou na CPU com WASM).
O áudio nunca sai do seu computador; só o modelo é baixado do Hugging Face, uma vez.

## Instalar

1. Baixe este repositório: botão verde **Code → Download ZIP** e extraia (ou `git clone`).
2. Abra `chrome://extensions` (ou `edge://extensions`) e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta extraída (a que tem o `manifest.json`).
4. Abra/recarregue https://web.whatsapp.com e clique em **Transcrever** num áudio.

Na primeira transcrição o modelo é baixado (aparece o progresso); depois fica em cache.

## Opções

Clique com o botão direito no ícone da extensão → **Opções**:

| Modelo | Download | Observação |
|---|---|---|
| tiny | ~40 MB | rápido, menos preciso |
| base | ~75 MB | padrão |
| small | ~250 MB | bom equilíbrio na CPU |
| medium | ~800 MB | preciso, lento sem GPU |
| large-v3-turbo | ~1,1–1,6 GB | o melhor; recomendado com GPU (≥ 2 GB de VRAM) |

- **Idioma:** português (padrão), inglês, espanhol ou detecção automática.
- **Processamento:** automático (usa a GPU via WebGPU se houver, senão CPU) ou só CPU.

Dica (Windows, notebook com duas GPUs): em **Configurações → Sistema → Tela → Gráficos**, coloque o Chrome
em **Alto desempenho** para usar a placa dedicada.

## Como funciona

- `main.js` (contexto da página): ao clicar em Transcrever, intercepta o próximo `play()` do áudio,
  deixa mudo, captura o arquivo (blob) e pausa.
- `content.js`: encontra os players de áudio, injeta o botão e mostra o resultado.
- `background.js`: cria um documento *offscreen* e faz a ponte de mensagens.
- `offscreen.js`: decodifica para 16 kHz mono e roda `pipeline("automatic-speech-recognition")`.

## Problemas comuns

- **Botão não aparece:** recarregue a aba do WhatsApp (F5). O indicador no canto inferior esquerdo
  mostra quantos áudios foram detectados; clicar nele copia um diagnóstico do DOM (sem conteúdo de mensagens).
- **Erros do modelo:** em `chrome://extensions`, abra o link **offscreen.html** da extensão e veja o console.

O WhatsApp muda o site com frequência; se algo parar de funcionar, os seletores ficam no topo de `content.js`.

## Licença

Código da extensão: MIT. Bibliotecas incluídas em `lib/`: veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Projeto não oficial, sem relação com o WhatsApp/Meta.
