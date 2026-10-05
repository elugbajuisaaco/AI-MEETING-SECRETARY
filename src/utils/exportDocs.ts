import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
} from 'docx';
import { jsPDF } from 'jspdf';
import { Meeting } from '../types';

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatFriendlyDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Generates and downloads a styled Microsoft Word (.docx) document
 */
export async function exportToWord(meeting: Meeting): Promise<void> {
  const docChildren: (Paragraph | Table)[] = [
    // Header
    new Paragraph({
      text: meeting.title || 'Meeting Minutes',
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),

    // Metadata Paragraph
    new Paragraph({
      children: [
        new TextRun({ text: 'Date: ', bold: true }),
        new TextRun({ text: formatFriendlyDate(meeting.date) + '   |   ' }),
        new TextRun({ text: 'Duration: ', bold: true }),
        new TextRun({ text: formatDuration(meeting.durationSeconds) + '   |   ' }),
        new TextRun({ text: 'Category: ', bold: true }),
        new TextRun({ text: meeting.category }),
      ],
      spacing: { after: 300 },
    }),

    // Executive Summary Heading
    new Paragraph({
      text: 'Executive Summary',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meeting.summary || 'No summary available.' })],
      spacing: { after: 300 },
    }),
  ];

  // Key Topics
  if (meeting.topics && meeting.topics.length > 0) {
    docChildren.push(
      new Paragraph({
        text: 'Key Agenda & Topics',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );
    meeting.topics.forEach((topic) => {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${topic}` })],
          spacing: { after: 80 },
        })
      );
    });
  }

  // Key Decisions
  if (meeting.decisions && meeting.decisions.length > 0) {
    docChildren.push(
      new Paragraph({
        text: 'Decisions & Milestones',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 250, after: 100 },
      })
    );
    meeting.decisions.forEach((dec) => {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: `✔ ${dec}` })],
          spacing: { after: 80 },
        })
      );
    });
  }

  // Action Items Table
  if (meeting.actionItems && meeting.actionItems.length > 0) {
    docChildren.push(
      new Paragraph({
        text: 'Action Items & Deliverables',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      })
    );

    const rows = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            width: { size: 10, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: 'Status', bold: true })] })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: 'Action Item / Task', bold: true })] })],
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: 'Assignee', bold: true })] })],
          }),
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: 'Due Date', bold: true })] })],
          }),
        ],
      }),
      ...meeting.actionItems.map(
        (item) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ text: item.completed ? '[DONE]' : '[TODO]' })],
              }),
              new TableCell({
                children: [new Paragraph({ text: item.task })],
              }),
              new TableCell({
                children: [new Paragraph({ text: item.assignee || 'Unassigned' })],
              }),
              new TableCell({
                children: [new Paragraph({ text: item.dueDate || 'ASAP' })],
              }),
            ],
          })
      ),
    ];

    docChildren.push(
      new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );
  }

  // Transcript Section
  docChildren.push(
    new Paragraph({
      text: 'Verbatim Meeting Transcript',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 150 },
    })
  );

  if (meeting.transcriptSegments && meeting.transcriptSegments.length > 0) {
    meeting.transcriptSegments.forEach((seg) => {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${seg.timestamp}] `, color: '64748B', size: 18 }),
            new TextRun({ text: `${seg.speaker}: `, bold: true, color: '1E293B' }),
            new TextRun({ text: seg.text }),
          ],
          spacing: { after: 120 },
        })
      );
    });
  } else {
    docChildren.push(
      new Paragraph({
        children: [new TextRun({ text: meeting.rawTranscript || 'No transcript recorded.' })],
        spacing: { after: 150 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const sanitizedTitle = (meeting.title || 'Meeting_Minutes').replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlob(blob, `${sanitizedTitle}.docx`);
}

/**
 * Generates and downloads a clean, branded PDF file
 */
export async function exportToPdf(meeting: Meeting): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = margin + 10;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 10;
    }
  };

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59); // slate-800
  const titleLines = doc.splitTextToSize(meeting.title || 'Meeting Minutes', contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 22;

  // Metadata Bar
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139); // slate-500
  const metaText = `Date: ${formatFriendlyDate(meeting.date)}  •  Duration: ${formatDuration(meeting.durationSeconds)}  •  Category: ${meeting.category}`;
  doc.text(metaText, margin, y);
  y += 18;

  // Divider Line
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.line(margin, y, margin + contentWidth, y);
  y += 18;

  // Executive Summary Section
  checkPageBreak(60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('Executive Summary', margin, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85); // slate-700
  const summaryLines = doc.splitTextToSize(meeting.summary || 'No summary available.', contentWidth);
  checkPageBreak(summaryLines.length * 14);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 14 + 16;

  // Key Topics
  if (meeting.topics && meeting.topics.length > 0) {
    checkPageBreak(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Key Agenda Topics', margin, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    meeting.topics.forEach((topic) => {
      const topicLines = doc.splitTextToSize(`• ${topic}`, contentWidth - 10);
      checkPageBreak(topicLines.length * 13);
      doc.text(topicLines, margin + 6, y);
      y += topicLines.length * 13 + 3;
    });
    y += 12;
  }

  // Action Items
  if (meeting.actionItems && meeting.actionItems.length > 0) {
    checkPageBreak(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Action Items & Tasks', margin, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    meeting.actionItems.forEach((item) => {
      const status = item.completed ? '[DONE]' : '[TODO]';
      const assignee = item.assignee ? ` (@${item.assignee})` : '';
      const due = item.dueDate ? ` - Due: ${item.dueDate}` : '';
      const text = `${status} ${item.task}${assignee}${due}`;
      const itemLines = doc.splitTextToSize(text, contentWidth - 10);

      checkPageBreak(itemLines.length * 13);
      doc.setTextColor(item.completed ? 100 : 30, item.completed ? 116 : 41, item.completed ? 139 : 59);
      doc.text(itemLines, margin + 6, y);
      y += itemLines.length * 13 + 4;
    });
    y += 12;
  }

  // Key Decisions
  if (meeting.decisions && meeting.decisions.length > 0) {
    checkPageBreak(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Key Decisions', margin, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    meeting.decisions.forEach((dec) => {
      const decLines = doc.splitTextToSize(`✔ ${dec}`, contentWidth - 10);
      checkPageBreak(decLines.length * 13);
      doc.text(decLines, margin + 6, y);
      y += decLines.length * 13 + 3;
    });
    y += 14;
  }

  // Transcript
  checkPageBreak(50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('Meeting Transcript', margin, y);
  y += 16;

  if (meeting.transcriptSegments && meeting.transcriptSegments.length > 0) {
    meeting.transcriptSegments.forEach((seg) => {
      checkPageBreak(30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`[${seg.timestamp}] ${seg.speaker}:`, margin, y);
      y += 12;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      const textLines = doc.splitTextToSize(seg.text, contentWidth - 12);
      checkPageBreak(textLines.length * 13);
      doc.text(textLines, margin + 12, y);
      y += textLines.length * 13 + 8;
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const rawLines = doc.splitTextToSize(meeting.rawTranscript || 'No transcript text available.', contentWidth);
    checkPageBreak(rawLines.length * 13);
    doc.text(rawLines, margin, y);
    y += rawLines.length * 13;
  }

  const sanitizedTitle = (meeting.title || 'Meeting_Minutes').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`${sanitizedTitle}.pdf`);
}

/**
 * Returns formatted Markdown for easy clipboard copying
 */
export function exportToMarkdown(meeting: Meeting): string {
  let md = `# ${meeting.title || 'Meeting Minutes'}\n\n`;
  md += `**Date:** ${formatFriendlyDate(meeting.date)} | **Duration:** ${formatDuration(meeting.durationSeconds)} | **Category:** ${meeting.category}\n\n`;
  md += `## Executive Summary\n${meeting.summary || 'N/A'}\n\n`;

  if (meeting.topics?.length) {
    md += `## Key Topics Discussed\n`;
    meeting.topics.forEach((t) => (md += `- ${t}\n`));
    md += `\n`;
  }

  if (meeting.decisions?.length) {
    md += `## Key Decisions\n`;
    meeting.decisions.forEach((d) => (md += `- [x] ${d}\n`));
    md += `\n`;
  }

  if (meeting.actionItems?.length) {
    md += `## Action Items\n`;
    meeting.actionItems.forEach((item) => {
      const assignee = item.assignee ? ` (@${item.assignee})` : '';
      const due = item.dueDate ? ` [Due: ${item.dueDate}]` : '';
      const check = item.completed ? '[x]' : '[ ]';
      md += `- ${check} ${item.task}${assignee}${due}\n`;
    });
    md += `\n`;
  }

  md += `## Verbatim Transcript\n`;
  if (meeting.transcriptSegments?.length) {
    meeting.transcriptSegments.forEach((seg) => {
      md += `**[${seg.timestamp}] ${seg.speaker}:** ${seg.text}\n\n`;
    });
  } else {
    md += `${meeting.rawTranscript || 'N/A'}\n`;
  }

  return md;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
