import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("          e.dateString === selectedDate &&\n          e.timestamp >= cutoff", "          e.dateString === selectedDate")

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
