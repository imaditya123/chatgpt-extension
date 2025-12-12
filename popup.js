document.getElementById('exportBtn').addEventListener('click', async () => {
  const filter = document.querySelector('input[name="filter"]:checked').value;
  const statusDiv = document.getElementById('status');
  const exportBtn = document.getElementById('exportBtn');
  
  statusDiv.className = 'status loading';
  statusDiv.textContent = '⏳ Generating PDF...';
  exportBtn.disabled = true;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('chatgpt.com') && !tab.url.includes('chat.openai.com')) {
      throw new Error('Please open a ChatGPT conversation first');
    }
    
    // Inject jsPDF library
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['jspdf.umd.min.js']
    });
    
    // Inject and run the PDF generation code
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: exportChatToPDF,
      args: [filter]
    });
    
    const result = results[0].result;
    
    if (result.success) {
      statusDiv.className = 'status success';
      statusDiv.textContent = `✅ PDF downloaded! (${result.messageCount} messages)`;
    } else {
      throw new Error(result.error || 'Failed to generate PDF');
    }
    
    setTimeout(() => {
      statusDiv.style.display = 'none';
      exportBtn.disabled = false;
    }, 3000);
    
  } catch (error) {
    console.error('Error:', error);
    statusDiv.className = 'status error';
    statusDiv.textContent = '❌ ' + error.message;
    exportBtn.disabled = false;
  }
});

// This function runs in the ChatGPT page context
function exportChatToPDF(filter) {
  try {
    if (typeof window.jspdf === 'undefined') {
      throw new Error('jsPDF library not loaded');
    }
    
    const { jsPDF } = window.jspdf;
    
    // Emoji map for common emojis (fallback)
    const emojiMap = {
      '🎉': '[*]', '✨': '[+]', '💡': '[!]', '🚀': '[>>]', 
      '❤️': '<3', '👍': '[+1]', '🔥': '[~]', '⚡': '[!]',
      '📝': '[doc]', '💬': '[msg]', '🤖': '[AI]', '👤': '[user]',
      '✅': '[v]', '❌': '[x]', '⚠️': '[!]', '📊': '[chart]',
      '🎯': '[o]', '🔧': '[tool]', '📦': '[box]', '🌟': '[*]'
    };
    
    // Get title
    let title = 'ChatGPT Conversation';
    const titleElement = document.querySelector('title');
    if (titleElement && titleElement.textContent.trim()) {
      const titleText = titleElement.textContent.trim();
      if (titleText !== 'ChatGPT') {
        title = titleText;
      }
    }
    
    // Extract messages with markdown content
    const messages = [];
    const allElements = document.querySelectorAll('[data-message-author-role]');
    
    allElements.forEach((element) => {
      const role = element.getAttribute('data-message-author-role');
      
      // Get the markdown content container
      const markdownDiv = element.querySelector('[class*="markdown"]') || 
                         element.querySelector('.prose') ||
                         element.querySelector('.whitespace-pre-wrap');
      
      if (!markdownDiv) return;
      
      // Extract content preserving structure
      const content = extractMarkdownContent(markdownDiv);
      
      if (content && content.length > 0) {
        if ((role === 'user' && (filter === 'both' || filter === 'user')) ||
            (role === 'assistant' && (filter === 'both' || filter === 'assistant'))) {
          messages.push({ role, content });
        }
      }
    });
    
    if (messages.length === 0) {
      throw new Error('No messages found in conversation');
    }
    
    // Create PDF with proper formatting
    const doc = new jsPDF();
    let y = 20;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    const maxWidth = 170;
    
    // Helper to convert emojis
    function replaceEmojis(text) {
      let result = text;
      Object.keys(emojiMap).forEach(emoji => {
        result = result.split(emoji).join(emojiMap[emoji]);
      });
      // Replace any remaining emojis with placeholder
      result = result.replace(/[\u{1F300}-\u{1F9FF}]/gu, '[emoji]');
      return result;
    }
    
    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(replaceEmojis(title), margin, y);
    y += 10;
    
    // Metadata
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | Filter: ${filter} | Messages: ${messages.length}`, margin, y);
    y += 12;
    doc.setTextColor(0);
    
    // Add messages with markdown rendering
    messages.forEach((msg) => {
      y = addMessageToPDF(doc, msg, y, pageHeight, margin, maxWidth, replaceEmojis);
    });
    
    // Save
    const filename = `ChatGPT_${title.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}_${filter}.pdf`;
    doc.save(filename);
    
    return {
      success: true,
      messageCount: messages.length,
      filename: filename
    };
    
  } catch (error) {
    console.error('PDF Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
  
  // Helper function to extract markdown content
  function extractMarkdownContent(element) {
    const contentParts = [];
    
    function traverse(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text.trim()) {
          contentParts.push({ type: 'text', content: text });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        
        // Headers
        if (tagName.match(/^h[1-6]$/)) {
          contentParts.push({ 
            type: 'header', 
            level: parseInt(tagName[1]),
            content: node.textContent.trim() 
          });
        }
        // Horizontal rule / separator
        else if (tagName === 'hr') {
          contentParts.push({ type: 'separator' });
        }
        // Line breaks
        else if (tagName === 'br') {
          contentParts.push({ type: 'line_break' });
        }
        // Code blocks
        else if (tagName === 'pre') {
          const codeElement = node.querySelector('code');
          const code = codeElement ? codeElement.textContent : node.textContent;
          const language = codeElement ? codeElement.className.replace('language-', '').replace('hljs', '').trim() : '';
          contentParts.push({ 
            type: 'code_block', 
            content: code.trim(),
            language: language
          });
        }
        // Inline code
        else if (tagName === 'code' && node.parentElement.tagName.toLowerCase() !== 'pre') {
          contentParts.push({ 
            type: 'inline_code', 
            content: node.textContent 
          });
        }
        // Bold
        else if (tagName === 'strong' || tagName === 'b') {
          contentParts.push({ 
            type: 'bold', 
            content: node.textContent 
          });
        }
        // Italic
        else if (tagName === 'em' || tagName === 'i') {
          contentParts.push({ 
            type: 'italic', 
            content: node.textContent 
          });
        }
        // Blockquote
        else if (tagName === 'blockquote') {
          contentParts.push({ 
            type: 'blockquote', 
            content: node.textContent.trim() 
          });
        }
        // Lists
        else if (tagName === 'ul' || tagName === 'ol') {
          const items = Array.from(node.querySelectorAll('li')).map(li => li.textContent.trim());
          contentParts.push({ 
            type: tagName === 'ul' ? 'unordered_list' : 'ordered_list', 
            items: items 
          });
        }
        // Tables
        else if (tagName === 'table') {
          const headers = Array.from(node.querySelectorAll('thead th')).map(th => th.textContent.trim());
          const rows = Array.from(node.querySelectorAll('tbody tr')).map(tr => 
            Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
          );
          if (headers.length > 0 || rows.length > 0) {
            contentParts.push({ 
              type: 'table', 
              headers: headers,
              rows: rows 
            });
          }
        }
        // Links
        else if (tagName === 'a') {
          const href = node.getAttribute('href');
          const text = node.textContent.trim();
          contentParts.push({ 
            type: 'link', 
            text: text,
            url: href 
          });
        }
        // Paragraphs
        else if (tagName === 'p') {
          node.childNodes.forEach(child => traverse(child));
          contentParts.push({ type: 'paragraph_break' });
        }
        // Other elements - traverse children
        else {
          node.childNodes.forEach(child => traverse(child));
        }
      }
    }
    
    traverse(element);
    return contentParts;
  }
  
  // Helper function to add message to PDF with formatting
  function addMessageToPDF(doc, msg, y, pageHeight, margin, maxWidth, replaceEmojis) {
    // Check if we need a new page
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 20;
    }
    
    // Role header
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    
    if (msg.role === 'user') {
      doc.setTextColor(0, 0, 0);
      doc.text('[user] You', margin, y);
    } else {
      doc.setTextColor(16, 163, 127);
      doc.text('[AI] ChatGPT', margin, y);
    }
    
    y += 8;
    doc.setTextColor(0, 0, 0);
    
    // Process content parts
    msg.content.forEach(part => {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      
      switch (part.type) {
        case 'header':
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14 - part.level);
          const headerText = replaceEmojis(part.content);
          const headerLines = doc.splitTextToSize(headerText, maxWidth);
          headerLines.forEach(line => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            doc.text(line, margin, y);
            y += 7;
          });
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          y += 3;
          break;
          
        case 'code_block':
          // Add top spacing
          y += 2;
          
          // Language label with background
          if (part.language) {
            doc.setFillColor(60, 60, 60);
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            
            // Draw language tag background
            const langText = part.language.toUpperCase();
            const langWidth = doc.getTextWidth(langText) + 4;
            doc.roundedRect(margin, y - 4, langWidth, 6, 1, 1, 'F');
            doc.text(langText, margin + 2, y);
            y += 8;
          }
          
          // Code block container
          doc.setFillColor(248, 248, 248);
          doc.setDrawColor(220, 220, 220);
          
          // Calculate code block height
          const codeLines = part.content.split('\n');
          const codeBlockHeight = codeLines.length * 4.5 + 4;
          
          // Check if entire code block fits on page
          if (y + codeBlockHeight > pageHeight - 20) {
            doc.addPage();
            y = 20;
            
            // Re-draw language label on new page
            if (part.language) {
              doc.setFillColor(60, 60, 60);
              doc.setTextColor(255, 255, 255);
              doc.setFontSize(8);
              doc.setFont('helvetica', 'bold');
              const langText = part.language.toUpperCase();
              const langWidth = doc.getTextWidth(langText) + 4;
              doc.roundedRect(margin, y - 4, langWidth, 6, 1, 1, 'F');
              doc.text(langText, margin + 2, y);
              y += 8;
            }
          }
          
          // Draw code block background
          const blockStartY = y;
          doc.roundedRect(margin - 3, y - 3, maxWidth + 6, codeBlockHeight, 2, 2, 'FD');
          
          // Draw line numbers background
          doc.setFillColor(238, 238, 238);
          doc.rect(margin - 3, y - 3, 12, codeBlockHeight, 'F');
          
          // Draw vertical separator between line numbers and code
          doc.setDrawColor(220, 220, 220);
          doc.line(margin + 9, y - 3, margin + 9, y - 3 + codeBlockHeight);
          
          // Render code with line numbers
          doc.setFont('courier', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(0, 0, 0);
          
          codeLines.forEach((line, index) => {
            if (y > pageHeight - 15) {
              // Handle code spanning multiple pages
              doc.addPage();
              y = 20;
              
              // Continue background on new page
              doc.setFillColor(248, 248, 248);
              doc.setDrawColor(220, 220, 220);
              const remainingLines = codeLines.length - index;
              const remainingHeight = remainingLines * 4.5 + 4;
              doc.roundedRect(margin - 3, y - 3, maxWidth + 6, remainingHeight, 2, 2, 'FD');
              
              // Line numbers background
              doc.setFillColor(238, 238, 238);
              doc.rect(margin - 3, y - 3, 12, remainingHeight, 'F');
              doc.setDrawColor(220, 220, 220);
              doc.line(margin + 9, y - 3, margin + 9, y - 3 + remainingHeight);
            }
            
            // Line number
            doc.setTextColor(150, 150, 150);
            doc.setFontSize(7);
            const lineNum = String(index + 1).padStart(2, ' ');
            doc.text(lineNum, margin - 1, y);
            
            // Code line
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(8);
            
            // Truncate line if too long
            let codeLine = line || ' ';
            const maxCodeWidth = maxWidth - 15;
            const textWidth = doc.getTextWidth(codeLine);
            
            if (textWidth > maxCodeWidth) {
              // Truncate and add ellipsis
              while (doc.getTextWidth(codeLine + '...') > maxCodeWidth && codeLine.length > 0) {
                codeLine = codeLine.slice(0, -1);
              }
              codeLine += '...';
            }
            
            doc.text(codeLine, margin + 11, y);
            y += 4.5;
          });
          
          // Bottom spacing
          y += 4;
          
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(0, 0, 0);
          break;
          
        case 'inline_code':
          doc.setFont('courier', 'normal');
          doc.setTextColor(199, 37, 78);
          doc.setFontSize(9);
          doc.text(part.content, margin, y);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(0);
          y += 5;
          break;
          
        case 'bold':
          doc.setFont('helvetica', 'bold');
          const boldText = replaceEmojis(part.content);
          const boldLines = doc.splitTextToSize(boldText, maxWidth);
          boldLines.forEach(line => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            doc.text(line, margin, y);
            y += 5;
          });
          doc.setFont('helvetica', 'normal');
          break;
          
        case 'italic':
          doc.setFont('helvetica', 'italic');
          const italicText = replaceEmojis(part.content);
          const italicLines = doc.splitTextToSize(italicText, maxWidth);
          italicLines.forEach(line => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            doc.text(line, margin, y);
            y += 5;
          });
          doc.setFont('helvetica', 'normal');
          break;
          
        case 'blockquote':
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(100);
          const quoteText = replaceEmojis(part.content);
          const quoteLines = doc.splitTextToSize('> ' + quoteText, maxWidth - 5);
          quoteLines.forEach(line => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            doc.text(line, margin + 5, y);
            y += 5;
          });
          doc.setTextColor(0);
          doc.setFont('helvetica', 'normal');
          y += 3;
          break;
          
        case 'unordered_list':
        case 'ordered_list':
          part.items.forEach((item, index) => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            const bullet = part.type === 'unordered_list' ? '•' : `${index + 1}.`;
            doc.text(bullet, margin, y);
            const itemText = replaceEmojis(item);
            const itemLines = doc.splitTextToSize(itemText, maxWidth - 10);
            itemLines.forEach((line, i) => {
              if (y > pageHeight - 15) {
                doc.addPage();
                y = 20;
              }
              doc.text(line, margin + 8, y);
              if (i < itemLines.length - 1) y += 5;
            });
            y += 6;
          });
          y += 3;
          break;
          
        case 'table':
          // Simple table rendering
          if (part.headers.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            const headerText = part.headers.join(' | ');
            doc.text(headerText, margin, y);
            y += 5;
            doc.setFont('helvetica', 'normal');
          }
          
          part.rows.forEach(row => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            const rowText = row.join(' | ');
            doc.text(rowText, margin, y);
            y += 5;
          });
          y += 5;
          break;
          
        case 'link':
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 238);
          doc.textWithLink(part.text || part.url, margin, y, { url: part.url });
          doc.setTextColor(0);
          y += 5;
          break;
          
        case 'text':
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          
          const textContent = replaceEmojis(part.content);
          const textLines = doc.splitTextToSize(textContent, maxWidth);
          
          textLines.forEach(line => {
            if (y > pageHeight - 15) {
              doc.addPage();
              y = 20;
            }
            doc.text(line, margin, y);
            y += 5;
          });
          break;
          
        case 'separator':
          if (y > pageHeight - 15) {
            doc.addPage();
            y = 20;
          }
          // Draw horizontal line
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.5);
          doc.line(margin, y, margin + maxWidth, y);
          y += 8;
          break;
          
        case 'line_break':
          y += 5;
          break;
          
        case 'paragraph_break':
          y += 4;
          break;
      }
    });
    
    y += 10;
    return y;
  }
}

// ===== INSTALLATION GUIDE =====
/*
FILES NEEDED:
=============
1. manifest.json
2. popup.html
3. popup.js
4. jspdf.umd.min.js - Download from:
   https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
   (Right-click -> Save As -> Save in extension folder)
5. icon16.png, icon48.png, icon128.png (any PNG images)

FOLDER STRUCTURE:
=================
chatgpt-pdf-extension/
  ├── manifest.json
  ├── popup.html
  ├── popup.js
  ├── jspdf.umd.min.js  ← MUST DOWNLOAD THIS
  ├── icon16.png
  ├── icon48.png
  └── icon128.png

FULL MARKDOWN FEATURES:
========================
✅ **Bold** and *italic* text
✅ Headers (# ## ### #### ##### ######)
✅ Code blocks with:
   - Language labels (dark background tags)
   - Line numbers (gray sidebar)
   - Syntax-highlighted background
   - Rounded corners
   - Border styling
   - Auto-truncation for long lines
   - Multi-page support
✅ `Inline code` with pink color
✅ • Bullet lists
✅ 1. Numbered lists
✅ > Blockquotes
✅ Tables (with headers and rows)
✅ [Links](url) - clickable in PDF
✅ Horizontal separators (---)
✅ Line breaks
✅ Emoji support (converted to text symbols)

CODE BLOCK FEATURES:
====================
Your code blocks now look professional with:

1. Language Tag (Dark):
   ┌─────────┐
   │ PYTHON  │  ← Dark gray background with white text
   └─────────┘

2. Line Numbers:
   ┌──┬────────────────────────────┐
   │ 1│ def hello():              │
   │ 2│     print("Hello")        │
   │ 3│     return True           │
   └──┴────────────────────────────┘
   ↑ Gray sidebar with numbers

3. Styled Container:
   - Light gray background (#f8f8f8)
   - Rounded corners
   - Border around entire block
   - Professional appearance

4. Smart Features:
   - Auto-wraps to next page if needed
   - Truncates very long lines (adds ...)
   - Preserves all line breaks
   - Courier font for code readability

EMOJI CONVERSION:
=================
Since jsPDF has limited emoji support, emojis are converted:
- 🎉 → [*]
- ✨ → [+]
- 💡 → [!]
- 🚀 → [>>]
- 👍 → [+1]
- 🔥 → [~]
- 💬 → [msg]
- 🤖 → [AI]
- 👤 → [user]
- ✅ → [v]
- ❌ → [x]

This prevents the corrupted symbols (Ø>Ý) you saw in your PDF!

USAGE:
======
1. Load extension in chrome://extensions/
2. Go to chatgpt.com conversation
3. Click extension icon
4. Select filter (both/user/assistant)
5. Click "Generate PDF"
6. PDF downloads with perfect formatting!

WHY EMOJIS ARE CONVERTED:
==========================
jsPDF's default fonts don't support Unicode emojis properly.
Options to fix this:
1. Convert to text (current solution - simple and reliable)
2. Use custom fonts with emoji support (complex, large file size)
3. Use images for emojis (very complex)

The text conversion approach keeps PDFs small and reliable while
preserving the meaning of emojis.
*/