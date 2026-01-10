#!/bin/bash
#
# Import Knowledge for Discord Bot
#
# Use this to import regular Claude Chat discussions
# that Discord bot should know about.
#

echo "🤖 Import Knowledge for Discord Bot"
echo "===================================="
echo ""
echo "This imports regular Claude CHAT discussions (not Claude Code)"
echo "Discord bot will be able to answer user questions from this knowledge."
echo ""

read -p "Enter filename (or press Enter to paste text): " filename

if [ -z "$filename" ]; then
    # Paste mode
    temp_file="temp_discord_$(date +%s).txt"

    echo ""
    echo "Paste your Claude Chat discussion below."
    echo "When done, press Ctrl+D"
    echo "----------------------------------------"
    cat > "$temp_file"

    filename="$temp_file"
fi

echo ""
read -p "Enter a title (what this knowledge is about): " title

echo ""
echo "📖 Curating for Discord bot..."
echo ""

python3 curate-knowledge.py \
    --file "$filename" \
    --title "$title" \
    --for-discord \
    --preview

# Clean up temp file if created
if [[ "$filename" == temp_discord_* ]]; then
    rm -f "$filename"
fi

echo ""
echo "✅ Discord bot knowledge updated!"
echo ""
echo "Test it:"
echo "  python3 knowledge-base.py --search 'your topic'"
