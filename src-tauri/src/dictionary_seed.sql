INSERT INTO entries (id, headword, normalized_headword, language, ipa, pronunciation, traditional, source) VALUES
('en:apple', 'apple', 'apple', 'en', '/ˈæp.əl/', NULL, NULL, 'FreeDict + Wiktionary'),
('en:abandon', 'abandon', 'abandon', 'en', '/əˈbæn.dən/', NULL, NULL, 'FreeDict + Wiktionary'),
('en:book', 'book', 'book', 'en', '/bʊk/', NULL, NULL, 'FreeDict + Wiktionary'),
('zh:苹果', '苹果', '苹果', 'zh', NULL, 'píng guǒ', '蘋果', 'CC-CEDICT'),
('zh:放弃', '放弃', '放弃', 'zh', NULL, 'fàng qì', '放棄', 'CC-CEDICT'),
('zh:书', '书', '书', 'zh', NULL, 'shū', '書', 'CC-CEDICT');

INSERT INTO senses (entry_id, part_of_speech, definition, position) VALUES
('en:apple', '名词', '苹果', 0),
('en:apple', '名词', '苹果树', 1),
('en:abandon', '动词', '放弃；抛弃', 0),
('en:abandon', '动词', '离弃；遗弃', 1),
('en:abandon', '名词', '放任；放纵', 2),
('en:book', '名词', '书；书籍', 0),
('en:book', '动词', '预订', 1),
('en:book', '动词', '登记', 2),
('zh:苹果', NULL, 'apple', 0),
('zh:苹果', NULL, 'apple tree', 1),
('zh:放弃', NULL, 'abandon', 0),
('zh:放弃', NULL, 'give up', 1),
('zh:放弃', NULL, 'renounce', 2),
('zh:书', NULL, 'book', 0),
('zh:书', NULL, 'letter', 1);

INSERT INTO entry_search (entry_id, term, normalized_term) VALUES
('en:apple', 'apple', 'apple'), ('en:abandon', 'abandon', 'abandon'),
('en:book', 'book', 'book'), ('zh:苹果', '苹果', '苹果'), ('zh:苹果', '蘋果', '蘋果'),
('zh:放弃', '放弃', '放弃'), ('zh:放弃', '放棄', '放棄'),
('zh:书', '书', '书'), ('zh:书', '書', '書');

INSERT INTO dictionary_metadata (key, value) VALUES
('version', 'development-seed-1'),
('built_at', 'bundled development data'),
('sources', 'FreeDict English-Chinese; English Wiktionary; CC-CEDICT'),
('license', 'Dictionary data remains subject to its source licenses, including CC BY-SA 4.0.');
