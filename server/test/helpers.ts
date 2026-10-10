import { PDFDocument, StandardFonts } from 'pdf-lib'

/** Builds a real PDF in memory: one entry per page, each a list of lines. */
export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage([612, 792])
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 16, size: 11, font }))
  }
  return doc.save()
}

export const SAMPLE_PAGES = [
  [
    'The Lean Startup method favors experimentation over elaborate planning.',
    'Founders build a minimum viable product to test their riskiest assumptions.',
  ],
  [
    'Customer development means talking to potential customers before building.',
    'Teams pivot when the evidence shows the original hypothesis was wrong.',
  ],
  [
    'Agile engineering ships small increments and gathers feedback continuously.',
    'Short release cycles reduce the cost of every wrong guess.',
  ],
]
