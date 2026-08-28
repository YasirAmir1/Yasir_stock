import re

with open('src/components/ReportsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_return = """  return (
    <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-4 dir-rtl text-slate-900">"""
new_return = """  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="p-3 sm:p-4 max-w-5xl mx-auto space-y-4 dir-rtl text-slate-900">"""

content = content.replace(old_return, new_return)

if "import { PullToRefresh } from './PullToRefresh';" not in content:
    content = content.replace("import { Download, Filter, TrendingUp, Calendar, ChevronDown, Check, Trash2, Printer } from 'lucide-react';", 
                              "import { Download, Filter, TrendingUp, Calendar, ChevronDown, Check, Trash2, Printer } from 'lucide-react';\nimport { formatWithCommas } from '../utils/numberUtils';\nimport { PullToRefresh } from './PullToRefresh';")

with open('src/components/ReportsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
