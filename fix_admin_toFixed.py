import re

with open('src/components/AdminScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

def replacer(match):
    val = match.group(1)
    return f"{{formatWithCommas(parseFloat({val}.toFixed({match.group(2)})))}}"

content = re.sub(r'\{([A-Za-z0-9_\.]+)\.toFixed\((\d+)\)\}', replacer, content)

with open('src/components/AdminScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
