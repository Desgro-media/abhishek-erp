import PDFDocument from "pdfkit";

export interface OfferLetterData {
  name: string;
  role: string;
  dept: string;
  salary: number;
  joinDate: string; // YYYY-MM-DD
  probationMonths: number;
  reportingTo: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00Z" : "")) : d;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

// Built-in PDF fonts have no ₹ glyph, so the amount is written as "INR".
const inr = (n: number) => `INR ${n.toLocaleString("en-IN")}`;

export function buildOfferLetterPdf(d: OfferLetterData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 60 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(20).text("DESGRO MEDIA");
    doc.font("Helvetica").fontSize(10).fillColor("#666").text("HiLITE Business Park, Kozhikode, Kerala");
    doc.moveDown(0.5);
    doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(1.5);

    doc.fillColor("#000").fontSize(11);
    doc.text(`Date: ${fmtDate(new Date())}`);
    doc.moveDown();
    doc.text(`Dear ${d.name},`);
    doc.moveDown();
    doc.text(`We are pleased to offer you the position of ${d.role} in the ${d.dept} department at DesGro Media.`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Key terms of this offer:");
    doc.moveDown(0.5);

    const rows: [string, string][] = [
      ["Position", d.role],
      ["Department", d.dept],
      ["Date of Joining", fmtDate(d.joinDate)],
      ["Monthly Salary", inr(d.salary)],
      ["Reporting To", d.reportingTo],
      ["Probation Period", `${d.probationMonths} month${d.probationMonths === 1 ? "" : "s"} from the date of joining`],
    ];
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font("Helvetica").fillColor("#666").text(k, 60, y, { width: 150 });
      doc.font("Helvetica-Bold").fillColor("#000").text(v, 210, y, { width: 325 });
    }
    doc.x = 60;
    doc.moveDown();
    doc.font("Helvetica").text(
      "This offer is subject to the accuracy of the information shared during the interview process. Your employment will be governed by DesGro Media's HR policies, communicated separately on joining.",
      60,
      doc.y,
      { width: 475 },
    );
    doc.moveDown();
    doc.text("Please confirm your acceptance by replying to this email.");
    doc.moveDown();
    doc.text("We look forward to having you on the team.");
    doc.moveDown(2);
    doc.text("Warm regards,");
    doc.font("Helvetica-Bold").text("HR Team");
    doc.font("Helvetica").text("DesGro Media");
    doc.end();
  });
}
