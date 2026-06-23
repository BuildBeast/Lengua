interface WordsProps {
  text: string;
  onWord: (word: string) => void;
}

// Strip surrounding punctuation/quotes so a click translates "hola" not "¡hola!".
const EDGE_PUNCT = /^[¡¿"'«»().,;:!?…—–-]+|[¡¿"'«»().,;:!?…—–-]+$/g;

/** Render text with each word individually clickable (whitespace preserved). */
export function Words({ text, onWord }: WordsProps) {
  // Split on whitespace but keep the separators so spacing is preserved.
  const tokens = text.split(/(\s+)/);
  return (
    <>
      {tokens.map((token, i) => {
        if (!/\S/.test(token)) return <span key={i}>{token}</span>;
        const clean = token.replace(EDGE_PUNCT, '');
        return (
          <button
            key={i}
            type="button"
            className="word"
            // If the user just drag-selected a phrase, the click that ends the
            // drag must not collapse it back to a single word — let the phrase
            // selection win.
            onClick={() => {
              if (window.getSelection?.()?.toString().trim()) return;
              onWord(clean || token);
            }}
            title="Translate this word"
          >
            {token}
          </button>
        );
      })}
    </>
  );
}
