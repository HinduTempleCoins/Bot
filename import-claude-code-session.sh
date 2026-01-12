#!/bin/bash
#
# Import Claude Code Session
#
# Use this to save our Claude Code conversations
# for context in future sessions (saves tokens).
#

echo "💻 Import Claude Code Session"
echo "=============================="
echo ""
echo "This saves our Claude CODE conversation for future reference."
echo "Next Claude Code session will know what we built today!"
echo ""

read -p "Enter filename (or press Enter to paste text): " filename

if [ -z "$filename" ]; then
    # Paste mode
    temp_file="temp_claude_code_$(date +%s).txt"

    echo ""
    echo "Paste this Claude CODE conversation below."
    echo "When done, press Ctrl+D"
    echo "----------------------------------------"
    cat > "$temp_file"

    filename="$temp_file"
fi

echo ""
read -p "Enter a title (what we worked on today): " title

# Suggest category based on title
echo ""
echo "Suggested categories:"
echo "  1) trading-bot"
echo "  2) knowledge-base"
echo "  3) discord-bot"
echo "  4) project-planning"
echo "  5) other (specify)"
echo ""
read -p "Choose category (1-5, or press Enter for auto-detect): " category_choice

case "$category_choice" in
    1) category="trading-bot" ;;
    2) category="knowledge-base" ;;
    3) category="discord-bot" ;;
    4) category="project-planning" ;;
    5)
        read -p "Enter category name: " category
        ;;
    *)
        category=""  # Auto-detect
        ;;
esac

echo ""
echo "📖 Curating Claude Code session..."
echo ""

if [ -z "$category" ]; then
    python3 curate-knowledge.py \
        --file "$filename" \
        --title "$title" \
        --preview
else
    python3 curate-knowledge.py \
        --file "$filename" \
        --title "$title" \
        --category "$category" \
        --preview
fi

# Clean up temp file if created
if [[ "$filename" == temp_claude_code_* ]]; then
    rm -f "$filename"
fi

echo ""
echo "✅ Claude Code context saved!"
echo ""
echo "Next Claude Code session will have this context available."
echo "Saves tokens by not re-explaining everything!"
