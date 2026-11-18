CREATE INDEX IF NOT EXISTS notifications_by_user_date ON notifications(user_id,created_at DESC,id DESC);

INSERT OR IGNORE INTO notifications(id,user_id,niche_id,message,read_at,created_at)
SELECT 'publication-' || p.id,n.user_id,n.id,'Post published.',
  COALESCE(p.published_at,p.updated_at),COALESCE(p.published_at,p.updated_at)
FROM publications p JOIN posts s ON s.id=p.post_id JOIN niches n ON n.id=s.niche_id
WHERE p.status='published';
