import html2pdf from 'html2pdf.js';

export async function downloadTicketPdf(element: HTMLElement, fileName: string): Promise<void> {
  await html2pdf()
    .set({
      margin: [3, 2, 3, 2],
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
      jsPDF: { unit: 'mm', format: [58, 297], orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    })
    .from(element)
    .save();
}
