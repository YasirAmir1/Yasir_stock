import re

with open('src/components/CalculatorModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Row 1
old_row1 = """          {/* Row 1 */}
          <button
            onClick={() => handleNum('7')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            7
          </button>
          <button
            onClick={() => handleNum('8')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            8
          </button>
          <button
            onClick={() => handleNum('9')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            9
          </button>"""

new_row1 = """          {/* Row 1 */}
          <button
            onClick={() => handleNum('9')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            9
          </button>
          <button
            onClick={() => handleNum('8')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            8
          </button>
          <button
            onClick={() => handleNum('7')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            7
          </button>"""

# Row 2
old_row2 = """          {/* Row 2 */}
          <button
            onClick={() => handleNum('4')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            4
          </button>
          <button
            onClick={() => handleNum('5')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            5
          </button>
          <button
            onClick={() => handleNum('6')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            6
          </button>"""

new_row2 = """          {/* Row 2 */}
          <button
            onClick={() => handleNum('6')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            6
          </button>
          <button
            onClick={() => handleNum('5')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            5
          </button>
          <button
            onClick={() => handleNum('4')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            4
          </button>"""

# Row 3
old_row3 = """          {/* Row 3 */}
          <button
            onClick={() => handleNum('1')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            1
          </button>
          <button
            onClick={() => handleNum('2')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            2
          </button>
          <button
            onClick={() => handleNum('3')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            3
          </button>"""

new_row3 = """          {/* Row 3 */}
          <button
            onClick={() => handleNum('3')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            3
          </button>
          <button
            onClick={() => handleNum('2')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            2
          </button>
          <button
            onClick={() => handleNum('1')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            1
          </button>"""

content = content.replace(old_row1, new_row1)
content = content.replace(old_row2, new_row2)
content = content.replace(old_row3, new_row3)

with open('src/components/CalculatorModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Buttons reordered!")
