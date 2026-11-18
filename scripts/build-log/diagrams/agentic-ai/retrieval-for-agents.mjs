// Diagrams for content/blog/retrieval-for-agents.mdx (Agentic AI).
//   node scripts/build-log/draw.mjs retrieval-for-agents
import { GREEN, MUTED, RED } from "../../../db-lab/canvas.mjs";
import { summaryMap } from "../_shared.mjs";

const post = {
  slug: "retrieval-for-agents",
  diagrams: {
    "meaning-map": {
      alt: "Text becomes numbers before it can be compared. A sentence such as 'Bananas are a great source of potassium' goes into an embedding model, all-MiniLM-L6-v2, which returns 384 numbers. The question 'fruit and nutrition' goes through the same model. Cosine similarity compares the two lists: 0.47 for bananas, 0.71 for 'Apples and oranges are healthy fruits', and 0.10 for a cricket sentence, so the two fruit sentences win although the banana one shares no word with the question.",
      draw(c) {
        c.size(720, 300).title("Turn text into numbers, then compare the numbers");
        const doc = c.box(20, 60, 190, 60, "a document", { tone: "plain", lines: "Bananas are a great source…" });
        const q = c.box(20, 170, 190, 60, "the question", { tone: "plain", lines: "fruit and nutrition" });
        const model = c.box(260, 112, 170, 64, "embedding model", { tone: "amber", lines: "all-MiniLM-L6-v2, 384 numbers" });
        const cos = c.box(480, 112, 220, 64, "cosine similarity", { tone: "green", lines: "same direction = same meaning" });
        c.arrow(doc.right, [258, 130]);
        c.arrow(q.right, [258, 158]);
        c.arrow(model.right, cos.left);
        c.para(480, 196, "Measured: apples and oranges 0.71, bananas 0.47, cricket 0.10.", { width: 220 });
        c.para(20, 262, "The banana sentence shares no word with the question and still ranks second. Keyword search could not do that.", { width: 680 });
        c.flow("a document", "embedding model", "", "data");
        c.flow("the question", "embedding model", "", "data");
        c.flow("embedding model", "cosine similarity", "", "data");
      },
    },

    "retrieve-rerank": {
      alt: "Two-stage search on eight sentences for the query 'COVID-19 Symptoms'. Stage one, the bi-encoder, embeds query and sentences separately and ranks by cosine similarity: the short sentence 'COVID-19 has many symptoms.' comes first at 0.92, and the sentence that actually lists symptoms is fourth. Stage two, the cross-encoder, reads each query and sentence pair together: the sentence that lists a high temperature, a cough and a lost sense of smell moves to first at 10.4. But the false sentence 'COVID-19 has the following symptom: memory loss, poor judgment, and confusion' moves up to second at 9.8. A reranker judges relevance, not truth.",
      draw(c) {
        c.size(720, 360).title("Retrieve fast, then rerank carefully");
        const docs = c.box(20, 64, 150, 70, "8 sentences", { tone: "plain", lines: ["query:", "COVID-19 Symptoms"] });
        const bi = c.box(210, 56, 220, 86, "1. bi-encoder", { tone: "amber", lines: ["each text embedded alone", "#1 'has many symptoms' 0.92", "real list of symptoms: #4"] });
        const cross = c.box(470, 56, 230, 86, "2. cross-encoder", { tone: "green", lines: ["reads query + sentence together", "#1 the real list 10.4", "#8 dementia −9.9"] });
        c.arrow(docs.right, bi.left);
        c.arrow(bi.right, cross.left, { label: "top K", labelDy: -8 });
        c.box(470, 182, 230, 70, "but #2 at 9.8", { tone: "red", lines: ["'COVID-19 … memory loss,", "poor judgment, confusion'"] });
        c.arrow([585, 142], [585, 180], { color: RED });
        c.para(20, 182, "The bi-encoder's document vectors are computed once and stored, so it can search millions in milliseconds. The cross-encoder runs the whole model per pair, so it only sees the top K.", { width: 420 });
        c.para(20, 300, "The false sentence has the right topic and the right shape, so it scores as relevant. Checking truth needs trusted sources in the knowledge base.", { width: 680, fill: MUTED });
        c.flow("8 sentences", "1. bi-encoder", "", "data");
        c.flow("1. bi-encoder", "2. cross-encoder", "top K", "data");
      },
    },

    "chunk-sizes": {
      alt: "The same short article about the heart, split three ways, and what comes back for the question 'What is the primary function of the heart?'. At 50 characters there are 16 chunks and the top result is a fragment: 'the body and removes metabolic waste. The heart'. At 150 characters there are 6 chunks and the top result is a whole sentence: 'The human heart is a muscular organ that pumps blood through the circulatory system.' At 400 characters there are 2 chunks and the answer is buried in half the article.",
      draw(c) {
        c.size(720, 280).title("One article, three chunk sizes, the same question");
        const cols = [
          ["50 characters", "red", ["16 chunks", "top hit: 'the body and", "removes metabolic waste.", "The heart'", "too small: ideas split"]],
          ["150 characters", "green", ["6 chunks", "top hit: 'The human heart", "is a muscular organ that", "pumps blood…'", "one idea per chunk"]],
          ["400 characters", "amber", ["2 chunks", "top hit: four sentences", "in one block", "", "too big: answer buried"]],
        ];
        cols.forEach(([name, tone, lines], i) => c.box(20 + i * 230, 56, 220, 150, name, { tone, lines }));
        c.para(20, 230, "RecursiveCharacterTextSplitter with 10% overlap. Measured on both runs; the splitter has no model in it, so the numbers are identical.", { width: 680, fill: MUTED });
      },
    },

    "heading-split": {
      alt: "Before and after for headings. Before, a fixed-length splitter that may only cut at line breaks packs lines into 200-character chunks, so chunk 3 ends with the heading '### Unsupervised Learning' while the text under it starts chunk 4. After, a Markdown header splitter makes one chunk per section, and each chunk carries its address as metadata: Header 1 Machine Learning Fundamentals, Header 2 Types of Machine Learning, Header 3 Unsupervised Learning.",
      draw(c) {
        c.size(720, 320).title("Before and after: a heading cut away from its text");
        c.text(20, 62, "Fixed length, cut at line breaks", { size: 12.5, weight: 700, fill: RED });
        c.text(380, 62, "Split at the headings", { size: 12.5, weight: 700, fill: GREEN });
        c.box(20, 74, 320, 84, "chunk 3", { tone: "plain", lines: ["- Classification …", "- Regression …", "### Unsupervised Learning"], mono: true });
        c.box(20, 174, 320, 84, "chunk 4", { tone: "red", lines: ["Unsupervised learning finds", "hidden patterns …", "(its heading is in chunk 3)"] });
        c.box(380, 74, 320, 184, "one chunk per section", { tone: "green", lines: ["Unsupervised learning finds", "hidden patterns …", "", "metadata: Header 1 Machine Learning", "Fundamentals > Header 2 Types of", "Machine Learning > Header 3 Unsupervised"] });
        c.para(20, 282, "The metadata can be shown as the source, used as a filter, or added to the chunk text before embedding.", { width: 680, fill: MUTED });
      },
    },

    hyde: {
      alt: "HyDE in two rows. Without it, the shopper's query 'I want running shoes' is searched with BM25 word matching against a product catalogue, and only one product matches, the Adidas Ultraboost, at a score of 1.59, because its title has the word Shoes. With HyDE, a model first writes four made-up product titles, and the query plus those titles is searched. On Groq the top three were all running shoes: Nike Pegasus 8.09, Adidas Ultraboost 6.32, Asics Gel-Kayano 4.45. Two Claude runs wrote different titles: in one, the top score rose to 11.06 but third place was Puma casual footwear, because the made-up titles said 'everyday comfort'; in the other, all three were running shoes.",
      draw(c) {
        c.size(720, 330).title("HyDE: search with a made-up answer, not the question");
        const q = c.box(20, 60, 200, 60, "shopper's query", { tone: "plain", lines: "I want running shoes" });
        const bm = c.box(270, 60, 180, 60, "BM25 word match", { tone: "raised", lines: "catalogue of products" });
        c.box(500, 60, 200, 60, "1 hit, score 1.59", { tone: "red", lines: "only 'Shoes' matched" });
        c.arrow(q.right, bm.left);
        c.arrow(bm.right, [498, 90]);
        const llm = c.box(20, 170, 200, 60, "model writes 4 titles", { tone: "amber", lines: "fake listings, never shown" });
        const bm2 = c.box(270, 170, 180, 60, "BM25 again", { tone: "raised", lines: "query + fake listings" });
        c.box(500, 150, 200, 50, "Groq: 3 running shoes", { tone: "green", lines: "8.09, 6.32, 4.45" });
        c.box(500, 210, 200, 50, "Claude: 2 runs differ", { tone: "amber", lines: "one put Puma casual 3rd" });
        c.arrow(q.bottom, llm.top);
        c.arrow(llm.right, bm2.left);
        c.arrow(bm2.right, [498, 178]);
        c.arrow(bm2.right, [498, 230]);
        c.para(20, 284, "The made-up words do the finding. 'Everyday comfort' in one Claude run matched 'casual footwear for everyday wear': HyDE can pull in the wrong neighbours, and which ones changes from run to run.", { width: 680, fill: MUTED });
        c.flow("shopper's query", "BM25 word match", "", "request");
        c.flow("shopper's query", "model writes 4 titles", "", "request");
        c.flow("model writes 4 titles", "BM25 again", "", "data");
      },
    },

    "summary-map": {
      alt: "A map of the post in four columns. Embeddings: text becomes 384 numbers, cosine compares direction, word maths like king minus man plus woman gives queen. Search: a bi-encoder retrieves fast, a cross-encoder reranks the top K, relevance is not truth. Chunking: size decides what can be found, overlap keeps edge sentences whole, headings make good cut points and metadata. HyDE: a made-up answer is searched instead of the question, one extra model call, and it can pull in wrong neighbours.",
      draw(c) {
        summaryMap(
          c,
          "Finding the right text, in four ideas",
          [
            { name: "Embeddings", lines: ["text -> 384 numbers", "cosine = direction", "king - man + woman", "= queen (0.85)"] },
            { name: "Search", lines: ["bi-encoder: fast", "cross-encoder: careful", "rerank only the top K", "relevance, not truth"] },
            { name: "Chunking", lines: ["size decides recall", "10% overlap", "cut at headings", "keep the address"] },
            { name: "HyDE", lines: ["search with a fake answer", "1 extra model call", "1.59 -> 8.09 (Groq)", "watch the neighbours"] },
          ],
          "Retrieval decides what the model gets to read. Most bad answers start here.",
        );
      },
    },
  },
};

export default post;
