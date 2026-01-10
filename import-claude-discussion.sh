#!/bin/bash
#
# Import Claude Discussion - Interactive Helper
#
# This script helps you import Claude discussions into the knowledge base
#

echo "📝 Claude Discussion Importer"
echo "=============================="
echo ""

# Check if datasets directory exists
mkdir -p datasets

echo "STEP 1: Export your Claude discussion"
echo "--------------------------------------"
echo "In Claude.ai:"
echo "  1. Click the three dots (⋮) at top of conversation"
echo "  2. Choose 'Export' → 'Download as PDF' OR just copy all text"
echo "  3. Save the file or prepare to paste text"
echo ""
echo "Press Enter when ready..."
read

echo ""
echo "STEP 2: Choose import method"
echo "-----------------------------"
echo "1) I have a PDF file"
echo "2) I'll paste the text"
echo ""
read -p "Choose (1 or 2): " choice

if [ "$choice" == "1" ]; then
    # PDF import
    echo ""
    read -p "Enter PDF filename (e.g., discussion.pdf): " filename

    if [ ! -f "$filename" ]; then
        echo "❌ File not found: $filename"
        echo "   Make sure the PDF is in the Bot directory"
        exit 1
    fi

    read -p "Enter a title for this discussion: " title
    read -p "Enter category (default: claude-discussion): " category
    category=${category:-claude-discussion}

    echo ""
    echo "📄 Importing PDF..."
    python3 web-scraper.py --source archive \
        --file "$filename" \
        --title "$title" \
        --output datasets

elif [ "$choice" == "2" ]; then
    # Text paste
    echo ""
    read -p "Enter a title for this discussion: " title
    read -p "Enter category (default: claude-discussion): " category
    category=${category:-claude-discussion}

    # Create temp file with unique name
    temp_file="datasets/temp_discussion_$(date +%s).txt"

    echo ""
    echo "Paste your Claude discussion below."
    echo "When done, press Ctrl+D (or Ctrl+Z on Windows)"
    echo "----------------------------------------"
    cat > "$temp_file"

    echo ""
    echo "📝 Importing text..."
    python3 web-scraper.py --source archive \
        --file "$temp_file" \
        --title "$title" \
        --output datasets

    # Clean up temp file
    rm "$temp_file"

else
    echo "Invalid choice"
    exit 1
fi

echo ""
echo "✅ Import complete!"
echo ""
echo "Next steps:"
echo "  1. Update knowledge base: python3 knowledge-base.py --datasets-dir datasets --stats"
echo "  2. Search your discussion: python3 knowledge-base.py --search 'topic'"
echo "  3. Import more discussions: ./import-claude-discussion.sh"
