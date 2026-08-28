import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_jsx = """                      {isEditing ? (
                        <div className="flex flex-col gap-2 w-full">"""

new_jsx = """                      {isEditing ? (
                        <>
                        <div className="flex flex-col gap-2 w-full">"""
content = content.replace(old_jsx, new_jsx)

old_jsx2 = """                          </button>
                        </div>
                        
                      ) : ("""

new_jsx2 = """                          </button>
                        </div>
                        </>
                      ) : ("""
content = content.replace(old_jsx2, new_jsx2)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
