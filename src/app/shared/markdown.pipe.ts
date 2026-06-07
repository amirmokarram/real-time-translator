import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// GitHub-flavoured markdown; treat single newlines as line breaks (chat-style).
marked.setOptions({ gfm: true, breaks: true });

// Force every rendered link to open in the external browser (the Electron main
// process intercepts target=_blank and routes it to shell.openExternal).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Render markdown → sanitized HTML for [innerHTML]. Sanitizing guards against
// any HTML/script the model might emit before it reaches the DOM.
@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    const html = marked.parse(value ?? '', { async: false }) as string;
    const clean = DOMPurify.sanitize(html);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
