package main

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

// HardWord 是一个人的重难点字：练习时写错过的汉字、字母或数字。
type HardWord struct {
	Char      string    `json:"char"`
	Misses    int       `json:"misses"` // 写错过的练习次数（一次练习里错几笔都只算一次）
	UpdatedAt time.Time `json:"updatedAt"`
}

type Store struct {
	db *sql.DB
}

// 表结构在启动时创建；以后加字段用 ALTER TABLE，并保证老数据还能读。
// 数据和用户绑定：user_id 是令牌里的 sub。
const schema = `
CREATE TABLE IF NOT EXISTS hard_words (
	user_id    TEXT NOT NULL,
	char       TEXT NOT NULL,
	misses     INTEGER NOT NULL DEFAULT 0,
	created_at TIMESTAMP NOT NULL,
	updated_at TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, char)
);
`

// OpenStore 打开模块自己的 SQLite 文件；数据库只属于本模块，放在本模块的卷里。
func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	// SQLite 同一时间只允许一个写入者，单连接可以避免 "database is locked"。
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// HardWords 按最近写错的时间倒序返回这个人的重难点字。
func (s *Store) HardWords(ctx context.Context, userID string) ([]HardWord, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT char, misses, updated_at FROM hard_words WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []HardWord{}
	for rows.Next() {
		var w HardWord
		if err := rows.Scan(&w.Char, &w.Misses, &w.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, w)
	}
	return list, rows.Err()
}

// AddMiss 记一次写错：没有就加入重难点，有就把次数加一。
func (s *Store) AddMiss(ctx context.Context, userID, char string) (*HardWord, error) {
	now := time.Now().UTC()
	w := &HardWord{Char: char, UpdatedAt: now}
	err := s.db.QueryRowContext(ctx, `INSERT INTO hard_words (user_id, char, misses, created_at, updated_at) VALUES (?, ?, 1, ?, ?)
		ON CONFLICT (user_id, char) DO UPDATE SET misses = misses + 1, updated_at = excluded.updated_at
		RETURNING misses`, userID, char, now, now).Scan(&w.Misses)
	return w, err
}

// RemoveHardWord 把一个字移出重难点（已经掌握）。
func (s *Store) RemoveHardWord(ctx context.Context, userID, char string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM hard_words WHERE user_id = ? AND char = ?`, userID, char)
	return err
}
