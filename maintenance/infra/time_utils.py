from datetime import datetime, timedelta, timezone

VN_TZ = timezone(timedelta(hours=7), name="ICT")


def now_vn() -> datetime:
    # Naive datetime tại VN wall clock (UTC+7).
    # PyMongo serialize naive datetime như UTC -> BSON int64 sẽ là ms-value
    # của VN wall clock, mongosh/Compass đọc thấy giờ VN trực quan.
    return datetime.now(VN_TZ).replace(tzinfo=None)


def utc_now() -> datetime:
    # Dùng cho APScheduler hoặc bất kỳ chỗ nào cần UTC thực sự.
    # KHÔNG dùng cho MongoDB persisted fields (giờ VN cho fields đó).
    return datetime.now(timezone.utc).replace(tzinfo=None)
